import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Logger } from "pino";
import { CHANGE_FIELDS } from "../../lib/changes";
import { breakdownFacts, CUT_HELP, CUTS, type RawBreakdown } from "../../lib/improver/breakdown";
import { checkNumbers, type Fact } from "../../lib/improver/facts";
import { NEEDS_BADGES, NEEDS_IDS, TURNS_ON_IDS } from "../../lib/improver/memory";
import { proposeProcessDraft } from "../../lib/improver/propose";
import { fmtValue } from "../../lib/format";
import { fmtN, METRIC_REGISTRY } from "../../lib/metrics";
import { describeOfficeHours } from "../../lib/working-hours";
import { loadRejectedIdeas, dbProposeStore } from "./store";
import { compareContext, loadImproverContext, type ImproverContext } from "./context";
import { loadCompare } from "../compare";
import { must } from "../changes";
import type { ProcessesDb } from "../context";
import { isOldEnoughForRead, saveProcessRead } from "./read-store";

/**
 * The Process Improver's tools (EDGEX-109 P4a, decision 4). Run-scoped, like draft-tools.ts: built fresh for each run, bound to the run's ONE
 * process (the trigger subject, never model input) and to the agent's own tenant through the scoped client. They are the only source of
 * numbers: every number comes back as a display string next to a fact id, and the evidence guard matches the model's words against exactly
 * those strings. Tools return counts and links, never a name, a phone number or a message. No free SQL: a cut is one name from a fixed menu.
 */

export interface ImproverToolsContext {
  db: ProcessesDb;
  tenantId: string;
  runId: string;
  agentId: string;
  /** The trigger subject: a process id (weekly run) or a process_versions id (the 7-days-live read). */
  subjectId: string | null;
  event: string;
  now: Date;
  logger: Logger;
}

export const IMPROVER_EVENT = "cron/process-improver";
export const AGED_EVENT = "process/version.aged";

const afterSchema = z.union([
  z.string().describe("New wording, for field 'wording' on a single part"),
  z.array(z.string()).describe("Position slugs for field 'who'; a list of lines for part 'exceptions' wording"),
  z.object({ value: z.number(), metric: z.string().optional() }).describe("A target: the new number, and a metric id only when switching measure"),
]);

const proposeSchema = z.object({
  summary: z.string().trim().min(1).max(240).describe("ONE short line for the banner. Use only numbers a tool showed, or none."),
  changes: z
    .array(
      z.object({
        part: z.string().min(1).describe("'step:<stepKey>' | 'trigger' | 'done' | 'exceptions'"),
        field: z.enum(CHANGE_FIELDS),
        after: afterSchema,
        why: z.string().trim().min(1).max(600).describe("Plain words for the owner. Every number must be one a tool displayed, copied exactly."),
        evidenceRefs: z.array(z.string().min(1)).min(1).max(8).describe("Fact ids from process_read / process_breakdown. At least one must be linkable."),
        needs: z.enum(NEEDS_IDS as [string, ...string[]]).nullish().describe("Only when the change depends on a feature that is not built yet"),
        turnsOn: z.enum(TURNS_ON_IDS as [string, ...string[]]).nullish().describe("Only when the owner must flip a Settings switch after approving"),
      }),
    )
    .min(1)
    .max(3),
});

const readSchema = z.object({ summary: z.string().trim().min(1).max(400).describe("2 short sentences on how the live version is doing. Use only numbers a tool showed.") });

const NO_PROCESS = { error: "This run has no process to look at." };

/** Fact ids + display strings only: the link stays server-side so the model can't alter it. */
const view = (f: Fact) => ({ id: f.id, display: f.display, linkable: f.href !== null });

export function buildImproverTools(ctx: ImproverToolsContext): ToolSet {
  let loaded: Promise<ImproverContext | null> | null = null;
  const load = (): Promise<ImproverContext | null> => {
    if (!ctx.subjectId) return Promise.resolve(null);
    loaded ??= loadImproverContext(ctx.db, ctx.tenantId, ctx.subjectId, ctx.now);
    return loaded;
  };

  const process_read = tool({
    description:
      "Read this run's process: the live version's steps with their target and their last-30-days number, whether each is on target, the office hours, the version history, the ideas the owner rejected recently, and the positions you may name in a 'who' change. Call this first. Every number comes with a fact id.",
    inputSchema: z.object({}),
    execute: async () => {
      const c = await load();
      if (!c) return NO_PROCESS;
      if (!c.live) return { error: "This process has no live version yet: nothing to improve." };
      for (const s of c.steps) c.facts.addAll([s.value, s.target]);
      const metricFacts: Fact[] = [];
      if (c.rawNow) {
        for (const [metric, def] of Object.entries(METRIC_REGISTRY[c.process.key])) {
          const v = def.read(c.rawNow);
          const f: Fact = { id: `metric.${metric}`, label: def.label, display: fmtValue(v, def.unit), raw: v, href: null };
          const frac = def.fraction?.(c.rawNow);
          if (v !== null) metricFacts.push(f);
          if (frac) metricFacts.push({ id: `metric.${metric}.fraction`, label: `${def.label} (counts)`, display: `${fmtN(frac.n)} of ${fmtN(frac.d)}`, raw: frac.n, href: null });
        }
        c.facts.addAll(metricFacts);
      }
      const versions = (must("versions read", await ctx.db.from("process_versions").select("version, status, source, approved_at, change_summary, rejected_reason, rejected_at").eq("process_id", c.process.id).order("version", { ascending: false }).limit(8)) as unknown as
        | Array<{ version: number; status: string; source: string; approved_at: string | null; change_summary: string | null; rejected_reason: string | null; rejected_at: string | null }>
        | null) ?? [];
      const hasDraft = versions.some((v) => v.status === "draft");
      const oh = (c.rawNow?.office_hours ?? null) as { days?: number[]; start_min?: number; end_min?: number } | null;
      const rejected = await loadRejectedIdeas(ctx.db, { processId: c.process.id, key: c.process.key, spec: c.live.spec, rawNow: c.rawNow }, ctx.now);
      return {
        process: { name: c.process.name, key: c.process.key, liveVersion: c.live.version, liveSince: c.live.approvedAt },
        window: `${c.window.firstDay} to ${c.window.lastDay} (30 days, the tenant's own days)`,
        onTarget: c.onTarget,
        openDraftExists: hasDraft,
        officeHours: oh?.days && oh.start_min != null && oh.end_min != null ? describeOfficeHours({ days: oh.days, startMin: oh.start_min, endMin: oh.end_min }) : null,
        steps: c.steps.map((s) => ({
          part: `step:${s.stepKey}`,
          title: s.title,
          who: s.who,
          measure: s.metricLabel,
          now: view(s.value),
          target: view(s.target),
          status: s.status,
          text: c.live!.spec.steps.find((x) => x.key === s.stepKey)?.text,
        })),
        otherNumbers: metricFacts.map(view),
        positions: c.positions,
        versions: versions.map((v) => ({ version: v.version, status: v.status, proposedBy: v.source, approvedAt: v.approved_at, summary: v.change_summary, rejectedBecause: v.rejected_reason })),
        recentlyRejectedIdeas: rejected.map((r) => ({
          part: r.part,
          field: r.field,
          direction: r.direction,
          rejectedOn: r.rejectedAt.slice(0, 10),
          reason: r.reason,
          numberMovedSince: r.movedSince,
          mayProposeAgain: r.movedSince,
        })),
        needsBadges: NEEDS_BADGES,
      };
    },
  });

  const process_breakdown = tool({
    description:
      "Cut this process's numbers by one of a FIXED menu of SQL cuts, to find out WHY a step is off target. Cuts: " +
      Object.entries(CUT_HELP).map(([k, v]) => `${k} (${v})`).join("; ") +
      ". A fact marked linkable opens exactly the counted leads and can be cited as evidence. Counts only: no names or messages.",
    inputSchema: z.object({ cut: z.enum(Object.keys(CUT_HELP) as [string, ...string[]]) }),
    execute: async ({ cut }) => {
      const c = await load();
      if (!c) return NO_PROCESS;
      if (!c.live) return { error: "This process has no live version yet." };
      if (!CUTS[c.process.key].includes(cut)) return { error: `The cut "${cut}" does not exist for ${c.process.name}. Available: ${CUTS[c.process.key].join(", ") || "none"}.` };
      const { data, error } = await ctx.db
        .raw()
        .rpc("education_process_breakdown", { p_tenant: ctx.tenantId, p_key: c.process.key, p_cut: cut, p_from: c.window.from.toISOString(), p_to: c.window.to.toISOString(), p_tz: c.tz });
      if (error || !data) {
        ctx.logger.warn({ err: error, cut, processKey: c.process.key }, "process_breakdown RPC failed");
        return { error: "That cut is not available right now." };
      }
      const arrived = typeof c.rawNow?.arrived === "number" ? (c.rawNow.arrived as number) : 0;
      const positionNames = new Map(c.positions.map((p) => [p.slug, p.name]));
      const out = breakdownFacts(cut, data as unknown as RawBreakdown, { key: c.process.key, window: c.window, listIds: c.listIds, intakeListIds: c.intakeListIds, positionNames, arrived });
      c.facts.addAll(out.facts);
      return { cut, help: CUT_HELP[cut], window: `${c.window.firstDay} to ${c.window.lastDay}`, total: out.total, groups: out.groups };
    },
  });

  const propose_process_draft = tool({
    description:
      "Propose a better version of this process as ONE draft with 1 to 3 changes. The owner reviews and approves it; you never edit a live process. Each change needs evidenceRefs (fact ids, at least one linkable) and a plain-words reason whose numbers are copied exactly from tool displays. Do NOT call this when the process is on target, when a draft is open, or for an idea listed in recentlyRejectedIdeas.",
    inputSchema: proposeSchema,
    execute: async (input) => {
      const c = await load();
      if (!c) return NO_PROCESS;
      try {
        const out = await proposeProcessDraft(dbProposeStore(ctx.db, { processId: c.process.id, key: c.process.key, spec: c.live?.spec ?? null, rawNow: c.rawNow }), {
          processKey: c.process.key,
          summary: input.summary,
          changes: input.changes.map((x) => ({ part: x.part, field: x.field, after: x.after, why: x.why, evidenceRefs: x.evidenceRefs, needs: (x.needs ?? null) as never, turnsOn: (x.turnsOn ?? null) as never })),
          facts: c.facts,
          onTarget: c.onTarget,
          now: ctx.now,
          meta: { runId: ctx.runId, window: { from: c.window.from.toISOString(), to: c.window.to.toISOString() }, arrived: typeof c.rawNow?.arrived === "number" ? (c.rawNow.arrived as number) : null, generatedAt: ctx.now.toISOString() },
        });
        for (const d of out.dropped) ctx.logger.info({ runId: ctx.runId, processKey: c.process.key, part: d.part, field: d.field, reason: d.reason }, "process improver: change dropped");
        if (out.kind === "none") {
          ctx.logger.info({ runId: ctx.runId, processKey: c.process.key, reason: out.reason }, "process improver: no draft");
          return { ok: false, message: out.reason, dropped: out.dropped };
        }
        return { ok: true, message: `Draft v${out.draft.version} recorded for the owner's review with ${out.changes.length} change(s).`, dropped: out.dropped };
      } catch (e) {
        ctx.logger.error({ err: e, runId: ctx.runId }, "process improver: draft write failed");
        return { ok: false, message: "The draft could not be saved. Nothing was changed." };
      }
    },
  });

  const process_compare = tool({
    description:
      "Before and after for the live version of this process: the same measures over the 30 days before it went live and the days since. Use for writing the read on a version. Every number comes with a fact id.",
    inputSchema: z.object({}),
    execute: async () => {
      const c = await load();
      if (!c) return NO_PROCESS;
      const out = await loadCompare(compareContext(ctx.db, c), c.process.key, null, ctx.now);
      if (out.kind !== "ok") return { error: "No before and after for this version yet." };
      const r = out.result;
      const measures = r.measures.map((m) => {
        const unit = m.unit;
        const mk = (suffix: string, v: number | null): Fact => ({ id: `compare.${m.metric}.${suffix}`, label: `${m.label}: ${suffix}`, display: fmtValue(v, unit), raw: v, href: null });
        const before = mk("before", m.before);
        const after = mk("after", m.after);
        const facts = [before, after];
        let change: Fact | null = null;
        if (m.change !== null) {
          const abs = Math.abs(m.change);
          change = { id: `compare.${m.metric}.change`, label: `${m.label}: change`, display: unit === "percent" ? `${m.change >= 0 ? "+" : "-"}${abs} points` : unit === "min" ? `${m.change >= 0 ? "+" : "-"}${abs}%` : `${m.change >= 0 ? "+" : "-"}${abs}`, raw: m.change, href: null };
          facts.push(change);
        }
        c.facts.addAll(facts);
        return { measure: m.label, ready: m.ready, better: m.better, before: view(before), after: view(after), change: change ? view(change) : null, note: m.ready ? null : m.waitText };
      });
      const days = { id: "compare.days_live", label: "Days the version has been live", display: `${r.current.daysLive} ${r.current.daysLive === 1 ? "day" : "days"}`, raw: r.current.daysLive, href: null };
      c.facts.add(days);
      return { version: r.current.version, daysLive: view(days), previousVersion: r.previous?.version ?? null, measures, changes: r.changes.map((x) => ({ title: x.title, status: x.status })) };
    },
  });

  const record_process_read = tool({
    description: "Record Orca's read on the live version: 2 short, honest sentences on how it is doing, from process_compare only. Never claim a result for a measure marked not ready.",
    inputSchema: readSchema,
    execute: async ({ summary }) => {
      const c = await load();
      if (!c || !c.live) return NO_PROCESS;
      // A second lock behind the planner: under 7 days live nothing is claimed (the same rule as before -> after).
      if (!isOldEnoughForRead(c.live.approvedAt, ctx.now)) return { ok: false, message: "This version has not been live for 7 days yet: no read." };
      const all = c.facts.all();
      const ok = checkNumbers(summary, all).ok;
      const ready = all.filter((f) => f.id.endsWith(".change"));
      const fallback = ready.length
        ? `Version ${c.live.version}, ${all.find((f) => f.id === "compare.days_live")?.display ?? "a few days"} in: ${ready.slice(0, 3).map((f) => `${f.label.replace(": change", "")} ${f.display}`).join("; ")}.`
        : `Version ${c.live.version} has not run long enough to judge yet.`;
      try {
        await saveProcessRead(ctx.db, {
          runId: ctx.runId,
          agentId: ctx.agentId,
          processId: c.process.id,
          versionId: c.live.id,
          version: c.live.version,
          summary: ok ? summary.trim() : fallback,
          usedFallback: !ok,
          now: ctx.now,
        });
        if (!ok) ctx.logger.info({ runId: ctx.runId, versionId: c.live.id }, "process improver: read summary failed the number guard, deterministic line used");
        return { ok: true, message: "Read recorded." };
      } catch (e) {
        ctx.logger.error({ err: e, runId: ctx.runId }, "process improver: read write failed");
        return { ok: false, message: "The read could not be saved." };
      }
    },
  });

  return ctx.event === AGED_EVENT ? { process_compare, record_process_read } : { process_read, process_breakdown, propose_process_draft };
}
