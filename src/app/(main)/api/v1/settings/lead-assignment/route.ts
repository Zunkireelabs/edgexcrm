import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiError, apiForbidden, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { LEARN_DAYS } from "@/industries/education-consultancy/features/home/lib/assignment/weights";
import { ASSIGNMENT_MODES, type AssignmentMode } from "@/industries/education-consultancy/features/home/lib/assignment/outcome";
import { loadProcessPolicy } from "@/industries/education-consultancy/features/processes/server/policy";
import { loadAssignmentSettings, loadLearnedPositions, resolveFirstTouchPositions } from "@/industries/education-consultancy/features/home/server/assignment/settings";

// GET/PUT /api/v1/settings/lead-assignment — owner / admin of an education tenant. { mode, first_touch_positions }.
// Default is "off". Shadow computes and stores picks but assigns nothing; auto assigns new leads as they arrive.
async function gate() {
  const auth = await authenticateRequest();
  if (!auth) return { res: apiUnauthorized() } as const;
  if (!getFeatureAccess(auth.industryId, FEATURES.EDU_HOME)) return { res: apiForbidden() } as const;
  if (auth.role !== "owner" && auth.role !== "admin") return { res: apiForbidden() } as const;
  return { auth } as const;
}

export async function GET() {
  const g = await gate();
  if ("res" in g) return g.res;
  const db = await scopedClient(g.auth);
  const s = await loadAssignmentSettings(db);
  const learned = await loadLearnedPositions(db);
  // Until the owner confirms, the positions in force are the learned ones, shown as a suggestion with the numbers behind it.
  const policy = await loadProcessPolicy(db, g.auth.tenantId);
  const fromProcess = policy.source && policy.firstTouchPositions ? policy.firstTouchPositions : null;
  let process: { key: string; name: string; version: number; step: string; positions: Array<{ slug: string; name: string }> } | null = null;
  if (fromProcess && policy.source) {
    // Slugs -> names, for the read-only chips (T4). Positions the tenant has since removed keep their slug.
    const { data: posRows } = await db.from("positions").select("slug, name");
    const nameBySlug = new Map(((posRows ?? []) as unknown as Array<{ slug: string; name: string }>).map((r) => [r.slug, r.name]));
    process = { key: policy.source.processKey, name: "New lead → first call", version: policy.source.version, step: "First contact", positions: fromProcess.map((slug) => ({ slug, name: nameBySlug.get(slug) ?? slug })) };
  }
  // While a process is live its positions are the ones in force; the saved/learned ones apply only when none is live.
  const inForce = fromProcess ?? (s.positionsSaved ? s.firstTouchPositions : learned.chosen.length ? learned.chosen : s.firstTouchPositions);
  return apiSuccess({
    mode: s.mode,
    process,
    first_touch_positions: inForce,
    positions_saved: s.positionsSaved,
    suggestion: { window_days: LEARN_DAYS, positions: learned.positions, chosen: learned.chosen, total: learned.total, covered: learned.covered },
  });
}

export async function PUT(request: NextRequest) {
  const g = await gate();
  if ("res" in g) return g.res;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }
  const errors: Record<string, string[]> = {};
  if (typeof body.mode !== "string" || !ASSIGNMENT_MODES.includes(body.mode as AssignmentMode)) errors.mode = ["Must be off, shadow or auto"];
  const positions = body.first_touch_positions;
  if (positions !== undefined && (!Array.isArray(positions) || positions.length === 0 || positions.some((p) => typeof p !== "string" || !/^[a-z0-9_-]{1,60}$/.test(p)))) {
    errors.first_touch_positions = ["Must be a non-empty list of position slugs"];
  }
  if (Object.keys(errors).length) return apiValidationError(errors);

  const db = await scopedClient(g.auth);
  // Positions are written ONLY when the owner sends them (confirming or changing the suggestion). Saving just the mode leaves them
  // as they were, so "never confirmed" stays distinguishable and the learned set keeps applying.
  const { error } = await db.from("lead_assignment_settings").upsert(
    {
      mode: body.mode,
      ...(positions !== undefined ? { first_touch_positions: positions as string[] } : {}),
      updated_by: g.auth.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) return apiError("DB_ERROR", "Failed to save", 500);
  const after = await loadAssignmentSettings(db);
  return apiSuccess({ mode: body.mode, first_touch_positions: await resolveFirstTouchPositions(db, after, new Date(), (await loadProcessPolicy(db, g.auth.tenantId)).firstTouchPositions), positions_saved: after.positionsSaved });
}
