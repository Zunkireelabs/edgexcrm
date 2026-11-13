import { createAuditLog } from "@/lib/api/audit";
import { parseOfficeHours, type OfficeHours, type OfficeHoursInput } from "../lib/working-hours";
import { loadOfficeHours, loadProcessPolicy } from "./policy";
import { describeWindow } from "../lib/policy";
import { PROCESS_NAMES } from "../lib/keys";
import type { ProcessesContext } from "./context";

/** Office hours for the Settings page and the audit trail (EDGEX-109 P3a). Reads/writes go through the migration 288 objects only. */

export interface OfficeHoursEvidence {
  /** Calls, meetings and human notes per weekday over the last 90 days, Sunday first. */
  byWeekday: number[];
  /** The same, per local hour 0–23. Shown as evidence only: start and end are never learned. */
  byHour: number[];
  total: number;
  windowDays: number;
}

export interface OfficeHoursView extends Pick<OfficeHours, "days" | "startMin" | "endMin"> {
  source: "saved" | "learned";
  tz: string;
  /** Events the learned value rests on (learned only). */
  events: number | null;
  /** Who saved it, and when (saved only). */
  updatedAt: string | null;
  updatedByName: string | null;
  evidence: OfficeHoursEvidence;
  /** The live process that counts working time from these hours (T3 "Used by"), or null when none does. */
  usedBy: { processKey: string; name: string; version: number; summary: string } | null;
}

const nums = (v: unknown, n: number): number[] => (Array.isArray(v) && v.length === n ? v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : Number(x) || 0)) : Array<number>(n).fill(0));

export async function loadOfficeHoursView(ctx: ProcessesContext): Promise<OfficeHoursView> {
  const db = ctx.db;
  const [ohRes, evRes, rowRes, policy] = await Promise.all([
    db.raw().rpc("education_office_hours", { p_tenant: ctx.auth.tenantId }),
    db.raw().rpc("education_office_hours_evidence", { p_tenant: ctx.auth.tenantId }),
    db.from("tenant_office_hours").select("updated_at, updated_by").maybeSingle(),
    loadProcessPolicy(db, ctx.auth.tenantId),
  ]);
  if (ohRes.error) throw new Error(`office hours read: ${ohRes.error.message}`);
  const oh = parseOfficeHours(ohRes.data);
  const raw = (ohRes.data ?? {}) as { events?: unknown };
  const ev = (evRes.error ? {} : (evRes.data ?? {})) as Record<string, unknown>;
  const row = (rowRes.error ? null : rowRes.data) as { updated_at: string; updated_by: string | null } | null;
  let updatedByName: string | null = null;
  if (oh.source === "saved" && row?.updated_by) {
    try {
      const { data } = await db.raw().auth.admin.getUserById(row.updated_by);
      const meta = data?.user?.user_metadata as Record<string, unknown> | undefined;
      const n = meta?.name ?? meta?.full_name;
      updatedByName = typeof n === "string" && n.trim() ? n.trim() : (data?.user?.email?.split("@")[0] ?? null);
    } catch {
      updatedByName = null;
    }
  }
  return {
    days: oh.days,
    startMin: oh.startMin,
    endMin: oh.endMin,
    source: oh.source === "saved" ? "saved" : "learned",
    tz: ctx.tz,
    events: oh.source === "saved" ? null : typeof raw.events === "number" ? raw.events : null,
    updatedAt: oh.source === "saved" ? (row?.updated_at ?? null) : null,
    updatedByName,
    usedBy:
      policy.source && policy.firstContact.clock === "working"
        ? { processKey: policy.source.processKey, name: PROCESS_NAMES[policy.source.processKey], version: policy.source.version, summary: `first contact within ${describeWindow(policy.firstContact.minutes, "working")}, assign within ${policy.assignWithinMin} minutes` }
        : null,
    evidence: { byWeekday: nums(ev.by_weekday, 7), byHour: nums(ev.by_hour, 24), total: typeof ev.total === "number" ? ev.total : 0, windowDays: typeof ev.window_days === "number" ? ev.window_days : 90 },
  };
}

/** Save the office hours (owner/admin already checked by the route) and write the audit row. Returns the new value. */
export async function saveOfficeHours(ctx: ProcessesContext, input: OfficeHoursInput, requestId?: string): Promise<OfficeHoursView> {
  const before = await loadOfficeHours(ctx.db, ctx.auth.tenantId);
  const { error } = await ctx.db.from("tenant_office_hours").upsert(
    { days: input.days, start_min: input.startMin, end_min: input.endMin, updated_by: ctx.auth.userId, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id" },
  );
  if (error) throw new Error(`office hours save: ${error.message}`);
  await createAuditLog({
    tenantId: ctx.auth.tenantId,
    userId: ctx.auth.userId,
    action: "office_hours.updated",
    entityType: "tenant_office_hours",
    entityId: ctx.auth.tenantId,
    changes: {
      days: { old: before.days, new: input.days },
      start_min: { old: before.startMin, new: input.startMin },
      end_min: { old: before.endMin, new: input.endMin },
      source: { old: before.source, new: "saved" },
    },
    requestId,
  });
  return loadOfficeHoursView(ctx);
}
