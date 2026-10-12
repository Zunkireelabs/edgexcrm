import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { leadQueryScope } from "@/lib/api/permissions";
import { canEnrollStudents, canMarkClassAttendance, canViewFullRoster } from "@/lib/api/class-attendance";
import { branchMemberIds, type LeadMembership } from "@/lib/leads/branch-membership";
import { canActOnEnrollmentLead } from "@/lib/classes/enrollment-scope";
import { visibleLeadsBase } from "@/lib/leads/visibility-query";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { ClassesWorkspace } from "@/industries/education-consultancy/features/classes/pages/classes-workspace";
import type { SupabaseClient } from "@supabase/supabase-js";

// Branch-share rows (lead_branches) for the roster's leads, in 250-ID chunks (URL-length safe).
async function fetchMembershipByLead(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
  leadIds: string[],
): Promise<Map<string, LeadMembership>> {
  const byLead = new Map<string, LeadMembership>();
  const CHUNK_SIZE = 250;
  for (let i = 0; i < leadIds.length; i += CHUNK_SIZE) {
    const { data } = await supabase
      .from("lead_branches")
      .select("lead_id, branch_id, assigned_to, is_origin")
      .eq("tenant_id", tenantId)
      .in("lead_id", leadIds.slice(i, i + CHUNK_SIZE));
    for (const r of (data ?? []) as Array<{ lead_id: string; branch_id: string; assigned_to: string | null; is_origin: boolean }>) {
      const list = byLead.get(r.lead_id) ?? [];
      list.push({ branch_id: r.branch_id, assigned_to: r.assigned_to ?? null, is_origin: r.is_origin ?? false });
      byLead.set(r.lead_id, list);
    }
  }
  return byLead;
}

// Fetch enrollments in 250-ID chunks to avoid Node/undici 16 KB URL limit.
async function fetchEnrollmentsByLeadIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
  leadIds: string[] | null,
): Promise<Array<Record<string, unknown>>> {
  if (leadIds !== null && leadIds.length === 0) return [];

  const buildQ = (chunk?: string[]) => {
    let q = supabase
      .from("class_enrollments")
      .select("*, leads!class_enrollments_lead_id_fkey(id,first_name,last_name,email,assigned_to,branch_id)")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (chunk && chunk.length > 0) q = q.in("lead_id", chunk);
    return q;
  };

  const CHUNK_SIZE = 250;
  if (!leadIds || leadIds.length <= CHUNK_SIZE) {
    const { data } = await buildQ(leadIds ?? undefined);
    return (data ?? []) as Array<Record<string, unknown>>;
  }

  const chunks: string[][] = [];
  for (let i = 0; i < leadIds.length; i += CHUNK_SIZE) {
    chunks.push(leadIds.slice(i, i + CHUNK_SIZE));
  }
  const results = await Promise.all(chunks.map((chunk) => buildQ(chunk)));
  return results.flatMap((r) => (r.data ?? []) as Array<Record<string, unknown>>);
}

export default async function ClassesRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.CLASSES)) notFound();

  const supabase = await createServiceClient();
  const userClient = await createClient(); // RLS-context client — leads_visible_to_user() needs a real auth.uid()

  const poolSlug = tenantData.tenant.industry_id === "education_consultancy" && tenantData.positionSlug && tenantData.branchId
    ? (POSITION_ROUTE_MAP[tenantData.positionSlug] ?? null)
    : null;
  const scope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId ?? null, poolSlug);

  const authSubject = { role: tenantData.role, userId: tenantData.userId, tenantId: tenantData.tenant.id };

  // Roster-view bypass: class_managers.view_roster grants full-roster visibility
  // independent of attendance-marking capability — own-scope lead filtering (built
  // for the leads list) would otherwise hide classmates the viewer isn't personally
  // assigned to. Compute this before the roster query so it can bypass the
  // own-scope restriction below. canMarkAttendance below is the separate
  // capability that gates the "Take attendance" button.
  const [canViewRoster, canMarkAttendance, canEnroll] = await Promise.all([
    canViewFullRoster(authSubject),
    canMarkClassAttendance(authSubject),
    canEnrollStudents(authSubject),
  ]);

  let leadIds: string[] | null = null;
  let teamMemberIds: string[] | null = null;

  if (scope.restrictToSelf && scope.userId && !canViewRoster) {
    // Visibility-scoped (uncapped; migration 179) — includes collaborator-visible leads,
    // not just direct assignments.
    const { data, error } = await visibleLeadsBase({ user: userClient, service: supabase }, tenantData.tenant.id, scope).is("deleted_at", null);
    if (error) {
      console.error("[classes/page] own-scope lead visibility query failed", {
        tenantId: tenantData.tenant.id, userId: scope.userId, error,
      });
    }
    leadIds = (data ?? []).map((l: { id: string }) => l.id);
  } else if (scope.branchId) {
    teamMemberIds = await branchMemberIds(supabase, tenantData.tenant.id, scope.branchId);
  }

  const [classesResult, enrollments] = await Promise.all([
    supabase
      .from("classes")
      .select("id, name, default_fee, is_active, end_date")
      .eq("tenant_id", tenantData.tenant.id)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    // Branch scope: inner-embed filter on the assignee's branch (no lead-id enumeration).
    // Self/all scope: chunked lead_id filter (overflow-safe) via the shared helper.
    teamMemberIds !== null
      ? (async () => {
          const { data } = await supabase
            .from("class_enrollments")
            .select("*, leads!class_enrollments_lead_id_fkey!inner(id,first_name,last_name,email,assigned_to,branch_id)")
            .eq("tenant_id", tenantData.tenant.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .in("leads.assigned_to", teamMemberIds);
          return (data ?? []) as Array<Record<string, unknown>>;
        })()
      : fetchEnrollmentsByLeadIds(supabase, tenantData.tenant.id, leadIds),
  ]);

  const classes = (classesResult.data ?? []) as Array<{
    id: string;
    name: string;
    default_fee: number | null;
    is_active: boolean;
    end_date: string | null;
  }>;

  // Per-student "may this user change it?" — the SAME rule the enrollment API enforces
  // (canActOnEnrollmentLead), so the screen can say "no permission" on click instead of after Save.
  // All-scope users (owner/admin) skip the branch-share lookup: they are never blocked.
  const scopeSubject = {
    userId: tenantData.userId,
    branchId: tenantData.branchId ?? null,
    branchMemberIds: teamMemberIds ?? [],
    permissions: tenantData.permissions,
  };
  const membershipByLead =
    tenantData.permissions.leadScope === "all" || enrollments.length === 0
      ? new Map<string, LeadMembership>()
      : await fetchMembershipByLead(supabase, tenantData.tenant.id, [...new Set(enrollments.map((e) => e.lead_id as string))]);
  for (const e of enrollments) {
    const lead = e.leads as { assigned_to: string | null; branch_id?: string | null } | null;
    e.can_edit = canActOnEnrollmentLead(
      scopeSubject,
      { assigned_to: lead?.assigned_to ?? null, branch_id: lead?.branch_id ?? null },
      membershipByLead.get(e.lead_id as string) ?? [],
    );
  }

  // Fees totals (aggregate amount + per-class collection %) are owner-only —
  // computed here, not in the client, so a non-owner is never handed a
  // precomputed total to read off props/devtools. Per-student fee_amount still
  // ships in `enrollments` regardless of role — that's the explicit, separate
  // "individual fee stays visible to roster viewers" requirement — so this
  // narrows the specific gap (a ready-made aggregate on a platter), it does not
  // make the aggregate unreconstructable by someone who can already see every
  // student's fee (summing what they're allowed to see was never in scope to
  // prevent).
  const canSeeFeesTotals = tenantData.role === "owner";
  let feesCollected: number | null = null;
  let classFeePct: Record<string, number | null> | null = null;
  if (canSeeFeesTotals) {
    let total = 0;
    const byClass: Record<string, { paid: number; payable: number }> = {};
    for (const e of enrollments) {
      const feePaid = e.fee_paid as boolean;
      const feeAmount = e.fee_amount as number | null;
      const status = e.status as string;
      const classId = e.class_id as string;
      if (feePaid && feeAmount != null) total += feeAmount;
      if (status !== "inactive") {
        const entry = byClass[classId] ?? { paid: 0, payable: 0 };
        entry.payable += 1;
        if (feePaid) entry.paid += 1;
        byClass[classId] = entry;
      }
    }
    feesCollected = total;
    classFeePct = {};
    for (const cls of classes) {
      const entry = byClass[cls.id];
      classFeePct[cls.id] = entry && entry.payable > 0 ? Math.round((entry.paid / entry.payable) * 100) : null;
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      <ClassesWorkspace
        classes={classes}
        enrollments={enrollments}
        canManage={tenantData.permissions.canManageClasses}
        canEnroll={canEnroll}
        canMarkAttendance={canMarkAttendance}
        tenantId={tenantData.tenant.id}
        canSeeFeesTotals={canSeeFeesTotals}
        feesCollected={feesCollected}
        classFeePct={classFeePct}
      />
    </div>
  );
}
