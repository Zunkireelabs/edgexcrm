import { describe, it, expect } from "vitest";
import { decodeFilterTree } from "@/lib/filters/serialize";
import { buildBaselineSpec } from "../baseline";
import type { ChangeRecord, SuggestStore } from "../changes-flow";
import { suggestChange } from "../changes-flow";
import { ADMIZZ_NEW_LEAD_RAW, ADMIZZ_SETUP } from "../fixtures";
import type { ProcessSpec } from "../spec";
import { breakdownFacts, needsImprovement, stepReads, type BreakdownCtx, type RawBreakdown } from "./breakdown";
import { checkNumbers, evidenceFromFacts, FactStore, numberTokens, type Fact } from "./facts";
import { cohortHref, datesOnWeekday, improverWindow, intakeLeftoverHref, weekdayHref } from "./links";
import { shadowEvidence, turnsOnProblem, type AssignmentState } from "./assignment";
import { blockingIdea, changeDirection, movedSince, type RejectedIdea } from "./memory";
import { proposeProcessDraft, type ProposeStore, type ProposedChange } from "./propose";

const KEY = "new_lead_first_call" as const;
const TZ = "Asia/Kathmandu";
const NOW = new Date("2026-11-08T14:15:00Z"); // Sun 8 Nov 20:00 Kathmandu
const W = improverWindow(NOW, TZ);
const LISTS = ["L-pre", "L-new", "L-arch"];

const fact = (id: string, display: string, href: string | null = "/leads?f=x"): Fact => ({ id, label: id, display, raw: null, href });

describe("numbers: tokens and the guard", () => {
  it("reads numbers with their unit; versions and ticket ids are not numbers", () => {
    expect(numberTokens("30% called within 3.1 h; 17 of 122; 1,234 leads; v3; EDGEX-104; 2.4 days; 45 min")).toEqual(["30%", "3.1h", "17", "122", "1234", "2.4d", "45min"]);
  });
  it("keeps a true number and drops a made-up one (same value, same unit)", () => {
    const facts = [fact("a", "30%"), fact("b", "17 of 122"), fact("c", "3.1 h")];
    expect(checkNumbers("Only 30% were called within 1 h, 3.1 h median; 17 of 122 arrived on Saturday", facts).unknown).toEqual(["1h"]);
    expect(checkNumbers("Only 30% (17 of 122) waited 3.1 h", facts)).toEqual({ ok: true, unknown: [] });
    expect(checkNumbers("Only 31% were called", facts)).toEqual({ ok: false, unknown: ["31%"] });
    // the unit matters: "30 leads" is not "30%"
    expect(checkNumbers("30 leads waited", facts).unknown).toEqual(["30"]);
  });
  it("the numbers inside a fact's own label (the tool's name for the measure) may be repeated, but only those", () => {
    const facts = [{ ...fact("m", "30%"), label: "Saturday: called within 1 working hour" }];
    expect(checkNumbers("30% were called within 1 working hour", facts).ok).toBe(true);
    expect(checkNumbers("30% were called within 2 working hours", facts).unknown).toEqual(["2"]);
  });
  it("extra allowed numbers cover a target the agent proposes itself", () => {
    expect(checkNumbers("Raise the target to 75%", [], ["75", "75%"]).ok).toBe(true);
  });
});

describe("evidence is rebuilt from the run's own facts", () => {
  it("the model supplies ids only; value and link come from the store; unknown ids are reported", () => {
    const store = new FactStore();
    store.add({ id: "by_weekday.6.size", label: "Saturday: new leads", display: "17 of 122", raw: 17, href: "/leads?f=sat", stepKey: null });
    const { evidence, missing } = evidenceFromFacts(["by_weekday.6.size", "made.up", "by_weekday.6.size"], store);
    expect(missing).toEqual(["made.up"]);
    expect(evidence).toEqual([{ metric: "by_weekday.6.size", label: "Saturday: new leads", value: "17 of 122", stepKey: null, href: "/leads?f=sat" }]);
  });
});

describe("links open exactly the counted group", () => {
  it("the window is 30 whole local days ending yesterday", () => {
    expect(W.firstDay).toBe("2026-10-09");
    expect(W.lastDay).toBe("2026-11-07");
    expect(W.to.toISOString()).toBe("2026-11-07T18:15:00.000Z"); // 8 Nov 00:00 Kathmandu
    expect(W.from.toISOString()).toBe("2026-10-08T18:15:00.000Z"); // 9 Oct 00:00 Kathmandu
  });
  it("Saturdays in the window: 4, 11, 18, 25 Oct... only those inside", () => {
    expect(datesOnWeekday(W, 6)).toEqual(["2026-10-10", "2026-10-17", "2026-10-24", "2026-10-31", "2026-11-07"]);
  });
  it("the weekday link is the cohort AND an OR of that weekday's dates", () => {
    const href = weekdayHref(W, LISTS, 6)!;
    const dec = decodeFilterTree(href.split("f=")[1]);
    expect(dec.ok).toBe(true);
    if (!dec.ok) return;
    expect(dec.tree.conditions.map((c) => c.field)).toEqual(["created_at", "tags", "stage"]);
    expect(dec.tree.conditions[0].value).toEqual(["2026-10-09", "2026-11-07"]);
    expect(dec.tree.conditions[2].value).toEqual(LISTS);
    expect(dec.tree.groups?.[0].conjunction).toBe("or");
    expect(dec.tree.groups?.[0].conditions.map((c) => c.value)).toEqual(datesOnWeekday(W, 6));
  });
  it("the cohort link has no weekday group; the intake link is unassigned + the intake lists (as Home's Review)", () => {
    const dec = decodeFilterTree(cohortHref(W, LISTS).split("f=")[1]);
    expect(dec.ok && dec.tree.groups).toBeFalsy();
    const intake = decodeFilterTree(intakeLeftoverHref(["L-new"])!.split("f=")[1]);
    expect(intake.ok && intake.tree.conditions.map((c) => [c.field, c.value])).toEqual([["assignees", ["unassigned"]], ["stage", ["L-new"]]]);
    expect(intakeLeftoverHref([])).toBeNull();
  });
});

describe("breakdown maths (fixtures)", () => {
  const ctx: BreakdownCtx = { key: KEY, window: W, listIds: LISTS, intakeListIds: ["L-new"], positionNames: new Map([["counselor", "Counselor"]]), arrived: 122 };
  const weekday: RawBreakdown = {
    cut: "by_weekday",
    groups: [
      { key: "0", n: 71, called_1h: 21, called_1wh: 40, never: 3, contact_p50: 186, contact_p75: 400, contact_p90: null, wait_p50: 100, wait_p75: null, wait_p90: null },
      { key: "6", n: 17, called_1h: 0, called_1wh: 0, never: 17, contact_p50: null, contact_p75: null, contact_p90: null, wait_p50: null, wait_p75: null, wait_p90: null },
    ],
  };
  it("a weekday group reads in the app's own formats, and links to exactly its leads", () => {
    const { facts, groups } = breakdownFacts("by_weekday", weekday, ctx);
    const by = (id: string) => facts.find((f) => f.id === id)!;
    expect(by("by_weekday.0.called_1h_pct").display).toBe("30%");
    expect(by("by_weekday.0.size").display).toBe("71 of 122");
    expect(by("by_weekday.0.first_contact_median" as never)?.display ?? by("by_weekday.0.contact_p50").display).toBe("3.1 h");
    expect(by("by_weekday.6.size").display).toBe("17 of 122");
    expect(by("by_weekday.6.never").display).toBe("17 of 17");
    expect(by("by_weekday.6.size").href).toBe(weekdayHref(W, LISTS, 6));
    expect(groups[1].label).toBe("Saturday");
    expect(groups[1].facts.size.linkable).toBe(true);
    // a group with no timing data has no timing fact at all (never an invented number)
    expect(facts.some((f) => f.id === "by_weekday.6.contact_p50")).toBe(false);
  });
  it("the model-facing view never carries a link", () => {
    const { groups } = breakdownFacts("by_weekday", weekday, ctx);
    expect(JSON.stringify(groups)).not.toContain("/leads");
  });
  it("cuts the leads list can't express are quotable but not linkable (office split, owner position)", () => {
    const split = breakdownFacts("office_split", { cut: "office_split", groups: [{ key: "outside", n: 17, called_1h: 2, called_1wh: 5, never: 1 }] }, ctx);
    expect(split.groups[0].facts.size.linkable).toBe(false);
    expect(split.groups[0].label).toBe("Arrived outside office hours");
    const pos = breakdownFacts("by_owner_position", { cut: "by_owner_position", groups: [{ key: "counselor", n: 5 }, { key: "unassigned", n: 2 }] }, ctx);
    expect(pos.groups.map((g) => g.label)).toEqual(["Counselor", "Not assigned yet"]);
  });
  it("intake leftovers: the total and the oldest are linkable to the unassigned intake leads", () => {
    const { facts, total } = breakdownFacts("intake_leftovers", { cut: "intake_leftovers", total: 7, oldest_days: 11, groups: [{ key: "4", n: 5 }, { key: "2", n: 2 }] }, ctx);
    expect(total).toEqual({ id: "intake.total", display: "7", linkable: true });
    expect(facts.find((f) => f.id === "intake.oldest")).toMatchObject({ display: "11 days", href: intakeLeftoverHref(["L-new"]) });
    expect(facts.find((f) => f.id === "intake.4.n")?.href).toBeNull();
  });
});

describe("steps and 'on target'", () => {
  const spec = buildBaselineSpec(KEY, ADMIZZ_SETUP);
  it("reads the live steps against the 30-day numbers; the headline step shows its fraction and links to the cohort", () => {
    const reads = stepReads(KEY, spec, ADMIZZ_NEW_LEAD_RAW, W, LISTS);
    const first = reads.find((r) => r.stepKey === "first_contact")!;
    expect(first.value.display).toBe("17% (22 of 131)");
    expect(first.value.href).toBe(cohortHref(W, LISTS));
    expect(first.status).toBe("red");
    expect(needsImprovement(reads)).toBe(true);
  });
  it("a process with every measured step on target gets no draft; no data at all is nothing to judge", () => {
    expect(needsImprovement([{ status: "met" }, { status: "met" }, { status: "unknown" }])).toBe(false);
    expect(needsImprovement([{ status: "unknown" }])).toBe(false);
    expect(needsImprovement([{ status: "met" }, { status: "amber" }])).toBe(true);
  });
});

describe("manners: the 60-day rejected-idea memory", () => {
  const before = { value: 80, metric: "first_contact_1h_pct" };
  const rejected = (over: Partial<RejectedIdea> = {}): RejectedIdea => ({
    part: "step:first_contact",
    field: "target",
    direction: changeDirection("target", before, { value: 60 }),
    rejectedAt: "2026-10-20T00:00:00Z",
    reason: "too soft",
    movedSince: false,
    ...over,
  });
  const p = { part: "step:first_contact", field: "target" as const, before, after: { value: 55 } };
  it("directions: up / down / switch / who / wording", () => {
    expect(changeDirection("target", before, { value: 90 })).toBe("target:up");
    expect(changeDirection("target", before, { value: 60 })).toBe("target:down");
    expect(changeDirection("target", before, { value: 80, metric: "first_contact_1wh_pct" })).toBe("target:switch:first_contact_1wh_pct");
    expect(changeDirection("who", ["a"], ["b", "a"])).toBe("who:a,b");
    expect(changeDirection("wording", "x", "y")).toBe("wording");
  });
  it("same part + same direction within 60 days is blocked; older, other direction or a moved number is not", () => {
    expect(blockingIdea(p, [rejected()], NOW)?.reason).toBe("too soft");
    expect(blockingIdea(p, [rejected({ rejectedAt: "2026-09-01T00:00:00Z" })], NOW)).toBeNull();
    expect(blockingIdea({ ...p, after: { value: 95 } }, [rejected()], NOW)).toBeNull();
    expect(blockingIdea(p, [rejected({ movedSince: true })], NOW)).toBeNull();
    expect(blockingIdea({ ...p, part: "step:assign" }, [rejected()], NOW)).toBeNull();
  });
  it("a number 'moved' by 5 points, 20% of a time, or any count; unknown never counts as moved", () => {
    expect(movedSince("percent", 30, 36)).toBe(true);
    expect(movedSince("percent", 30, 33)).toBe(false);
    expect(movedSince("min", 100, 125)).toBe(true);
    expect(movedSince("min", 100, 110)).toBe(false);
    expect(movedSince("count", 7, 8)).toBe(true);
    expect(movedSince("percent", null, 50)).toBe(false);
  });
});

// ── the proposal flow, over an in-memory world ──────────────────────────────────────────────
const POS = new Set(["counselor", "lead-executive", "branch-manager"]);
function world(opts: { personDraft?: boolean; rejected?: RejectedIdea[]; failInsertAt?: number } = {}) {
  const spec = buildBaselineSpec(KEY, ADMIZZ_SETUP);
  const drafts: Array<{ id: string; version: number; spec: ProcessSpec; source: string; proposed_by: string | null; change_summary: string; evidence: unknown }> = [];
  if (opts.personDraft) drafts.push({ id: "d-person", version: 2, spec, source: "person", proposed_by: "u1", change_summary: "x", evidence: {} });
  const inserted: ChangeRecord[] = [];
  const deleted: string[] = [];
  const base: SuggestStore = {
    async getProcess() { return { id: "p1", owner_user_id: "o1", live_version_id: "v1" }; },
    async getSpec() { return spec; },
    async getOpenDraft() { const d = drafts[0]; return d ? { id: d.id, version: d.version, status: "draft" } : null; },
    async maxVersion() { return 1 + drafts.length; },
    async createDraft(row) {
      if (drafts.length) return null;
      const d = { id: "d-orca", version: row.version, spec: row.spec as ProcessSpec, source: row.source ?? "person", proposed_by: row.proposed_by, change_summary: row.change_summary, evidence: row.evidence };
      drafts.push(d);
      return { id: d.id, version: d.version, status: "draft" };
    },
    async insertChange() { throw new Error("person path not used by Orca"); },
    async positionSlugs() { return POS; },
  };
  const store: ProposeStore = {
    ...base,
    async rejectedIdeas() { return opts.rejected ?? []; },
    async insertAgentChange(row) {
      if (opts.failInsertAt !== undefined && inserted.length === opts.failInsertAt) throw new Error("db down");
      const c: ChangeRecord = { ...row, id: `c${inserted.length + 1}`, status: "open", taken: true, edited_by: null, edited_at: null, created_at: "2026-11-08T00:00:00Z" };
      inserted.push(c);
      return c;
    },
    async deleteDraft(id) { deleted.push(id); drafts.splice(0, drafts.length); },
  };
  return { store, drafts, inserted, deleted, spec, base };
}

const facts = () => {
  const s = new FactStore();
  s.addAll([
    { id: "by_weekday.6.size", label: "Saturday: new leads", display: "17 of 122", raw: 17, href: "/leads?f=sat" },
    { id: "by_weekday.0.called_1h_pct", label: "Sunday: called within 1 hour", display: "30%", raw: 30, href: "/leads?f=sun" },
    { id: "assign.state", label: "Smart assignment right now", display: "Smart assignment is off", raw: "off", href: null },
    { id: "office_split.outside.size", label: "Outside office hours", display: "17 of 122", raw: 17, href: null },
  ]);
  return s;
};
const META = { runId: "r1", window: { from: "a", to: "b" }, arrived: 122, generatedAt: NOW.toISOString() };
const good: ProposedChange = {
  part: "step:first_contact",
  field: "target",
  after: { value: 70 },
  why: "Only 30% of Sunday leads were called within the hour, and 17 of 122 arrived on a Saturday when the office is closed.",
  evidenceRefs: ["by_weekday.0.called_1h_pct", "by_weekday.6.size"],
};
const STATE_OFF: AssignmentState = { mode: "off", shadowDecisions30d: 0, agreement: { matched: 0, total: 0, pct: null }, shadowDays: null, shadowRanLongEnough: false, capacity: { found: true, eligible: 2, poolSize: 3 } };
const run = (w: ReturnType<typeof world>, over: Partial<Parameters<typeof proposeProcessDraft>[1]> = {}) =>
  proposeProcessDraft(w.store, { processKey: KEY, summary: "Orca suggests a softer first-call target.", changes: [good], facts: facts(), onTarget: false, now: NOW, meta: META, ...over });

describe("proposeProcessDraft", () => {
  it("writes ONE draft as the agent: source 'agent', no proposer, the banner line, run metadata, changes authored by the agent with their evidence", async () => {
    const w = world();
    const out = await run(w);
    expect(out.kind).toBe("created");
    expect(w.drafts).toHaveLength(1);
    expect(w.drafts[0]).toMatchObject({ source: "agent", proposed_by: null, change_summary: "Orca suggests a softer first-call target.", evidence: META });
    expect(w.inserted).toHaveLength(1);
    expect(w.inserted[0]).toMatchObject({ author_kind: "agent", author_user_id: null, part: "step:first_contact", field: "target" });
    expect(w.inserted[0].evidence.map((e) => e.href)).toEqual(["/leads?f=sun", "/leads?f=sat"]);
    expect(w.inserted[0].before).toMatchObject({ metric: "first_contact_1h_pct" });
  });
  it("a made-up number in the reason drops the change (and with it the draft); a true one is kept", async () => {
    const w = world();
    const out = await run(w, { changes: [{ ...good, why: "Only 31% of Sunday leads were called within the hour." }] });
    expect(out.kind).toBe("none");
    expect(out.dropped[0].reason).toMatch(/31%/);
    expect(w.drafts).toHaveLength(0);
    const mixed = await run(world(), { changes: [{ ...good, why: "Only 31% were called." }, { ...good, part: "step:call_back", why: "Only 30% were called." }] });
    expect(mixed.kind).toBe("created");
    expect(mixed.dropped).toHaveLength(1);
  });
  it("a change must cite a link: evidence with no link, or ids no tool produced, drops it", async () => {
    expect((await run(world(), { changes: [{ ...good, evidenceRefs: ["office_split.outside.size"] }] })).dropped[0].reason).toMatch(/link/);
    expect((await run(world(), { changes: [{ ...good, evidenceRefs: ["nope"] }] })).dropped[0].reason).toMatch(/no tool produced: nope/);
  });
  it("new wording may not smuggle in a number either", async () => {
    const w = world();
    const out = await run(w, { changes: [{ ...good, field: "wording", part: "step:first_contact", after: "Call every new lead. 90% should be called within 12 hours.", why: "Saturday leads wait." }] });
    expect(out.kind).toBe("none");
    expect(out.dropped[0].reason).toMatch(/wording/);
  });
  it("a banner line with a made-up number is replaced by a plain count", async () => {
    const out = await run(world(), { summary: "Orca found that 99% of leads wait." });
    expect(out.kind === "created" && out.summary).toBe("Orca suggests 1 change.");
  });
  it("never lands while a person's draft is open", async () => {
    const w = world({ personDraft: true });
    const out = await run(w);
    expect(out).toMatchObject({ kind: "none", reason: expect.stringMatching(/already open/) });
    expect(w.drafts).toHaveLength(1);
    expect(w.drafts[0].source).toBe("person");
    expect(w.inserted).toHaveLength(0);
  });
  it("a process on target gets no draft", async () => {
    const w = world();
    expect(await run(w, { onTarget: true })).toMatchObject({ kind: "none" });
    expect(w.drafts).toHaveLength(0);
  });
  it("validation is the person path's: the same invalid change fails with the same words", async () => {
    const bad = { part: "step:first_contact", field: "target" as const, after: { value: 150 } };
    const mine = await run(world(), { changes: [{ ...good, ...bad }] });
    const w = world();
    const theirs = await suggestChange(w.base, { processKey: KEY, userId: "u1", input: { ...bad, why: "x", evidence: [] } });
    expect(theirs.kind).toBe("invalid");
    expect(mine.dropped[0].reason).toBe(theirs.kind === "invalid" ? theirs.error : "");
    // an unknown position is refused by the same check
    const who = await run(world(), { changes: [{ ...good, field: "who", after: ["ghost"] }] });
    expect(who.dropped[0].reason).toMatch(/Unknown position/);
  });
  it("never re-proposes a rejected idea inside 60 days, unless the number moved", async () => {
    const idea: RejectedIdea = { part: "step:first_contact", field: "target", direction: "target:down", rejectedAt: "2026-10-20T00:00:00Z", reason: "too soft", movedSince: false };
    const blocked = await run(world({ rejected: [idea] }));
    expect(blocked.kind).toBe("none");
    expect(blocked.dropped[0].reason).toMatch(/Rejected on 2026-10-20 .*too soft/);
    expect((await run(world({ rejected: [{ ...idea, movedSince: true }] }))).kind).toBe("created");
  });
  it("at most 3 changes, and never two to the same part and field", async () => {
    const mk = (part: string): ProposedChange => ({ ...good, part });
    const out = await run(world(), { changes: [mk("step:first_contact"), mk("step:first_contact"), mk("step:assign"), mk("step:call_back"), mk("step:decide")] });
    expect(out.kind).toBe("created");
    expect(out.kind === "created" && out.changes.map((c) => c.part)).toEqual(["step:first_contact", "step:assign", "step:call_back"]);
    expect(out.dropped.map((d) => d.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/same part/), expect.stringMatching(/More than 3/)]));
  });
  it("carries Orca's badges from the fixed lists", async () => {
    const w = world();
    await run(w, { assignment: STATE_OFF, changes: [{ ...good, needs: "EDGEX-104", turnsOn: "smart_assignment_shadow", evidenceRefs: [...good.evidenceRefs, "assign.state"] }] });
    expect(w.inserted[0]).toMatchObject({ needs: "EDGEX-104", turns_on: "smart_assignment_shadow" });
  });
  it("names the real feature: 'the system' in new wording is dropped, 'Smart assignment gives it' is kept", async () => {
    const wording = (after: string): ProposedChange => ({ ...good, field: "wording", part: "step:assign", after, why: "Saturday leads wait." });
    const bad = await run(world(), { changes: [wording("The system assigns it to the Counselor with the most room.")] });
    expect(bad.kind).toBe("none");
    expect(bad.dropped[0].reason).toMatch(/Smart assignment gives it/);
    expect((await run(world(), { changes: [wording("Smart assignment gives it to the Counselor with the most room.")] })).kind).toBe("created");
  });
  it("skipped red steps: kept for real steps, one line each, numbers guarded, stored beside the run metadata", async () => {
    const w = world();
    const out = await run(w, { offTargetSteps: ["call_back", "decide"], skipped: [{ step: "step:call_back", reason: "Rota-driven." }, { step: "assign", reason: "not red" }, { step: "decide", reason: "Only 77% were decided." }] });
    expect(out.kind).toBe("created");
    expect(w.drafts[0].evidence).toMatchObject({ ...META, skipped: [{ step: "call_back", reason: "Rota-driven." }] });
    expect(out.dropped.some((d) => d.field === "skipped")).toBe(true);
  });
  it("if writing the changes fails halfway, the half-made draft is removed and the error surfaces", async () => {
    const w = world({ failInsertAt: 1 });
    await expect(run(w, { changes: [good, { ...good, part: "step:assign" }] })).rejects.toThrow(/db down/);
    expect(w.deleted).toEqual(["d-orca"]);
    expect(w.drafts).toHaveLength(0);
  });
});

describe("smart assignment evidence and rules", () => {
  const D = (daysAgo: number, mode: "shadow" | "auto" = "shadow", outcome: "matched" | "overridden" | null = "matched") => ({ mode, outcome, created_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString() });
  it("shadow evidence: counts the last 30 days, agreement, days since the first decision, and 'ran long enough' needs 14+ days AND recent decisions", () => {
    expect(shadowEvidence([], NOW)).toMatchObject({ shadowDecisions30d: 0, shadowDays: null, shadowRanLongEnough: false });
    const ran = shadowEvidence([D(20), D(10), D(3, "shadow", "overridden"), D(40)], NOW);
    expect(ran).toMatchObject({ shadowDecisions30d: 3, shadowDays: 40, shadowRanLongEnough: true });
    expect(ran.agreement).toEqual({ matched: 2, total: 3, pct: 67 });
    expect(shadowEvidence([D(5), D(2)], NOW).shadowRanLongEnough).toBe(false); // only 5 days old
    expect(shadowEvidence([D(30), D(25)], NOW).shadowRanLongEnough).toBe(false); // old, but nothing in the last 14 days
    expect(shadowEvidence([D(20, "auto")], NOW).shadowDecisions30d).toBe(0); // auto decisions are not shadow
  });
  const state = (over: Partial<AssignmentState> = {}): AssignmentState => ({ ...STATE_OFF, ...over });
  const cited = ["assign.state"];
  it("shadow: only from off, only with capacity, only citing the state", () => {
    expect(turnsOnProblem("smart_assignment_shadow", state(), cited)).toBeNull();
    expect(turnsOnProblem("smart_assignment_shadow", state(), [])).toMatch(/must cite/);
    expect(turnsOnProblem("smart_assignment_shadow", state({ mode: "shadow" }), cited)).toMatch(/already shadow/);
    expect(turnsOnProblem("smart_assignment_shadow", state({ capacity: { found: false, eligible: 0, poolSize: 3 } }), cited)).toMatch(/assign no one/);
  });
  it("auto: only after shadow ran 14+ days with decisions", () => {
    expect(turnsOnProblem("smart_assignment_auto", state({ mode: "shadow", shadowRanLongEnough: false }), cited)).toMatch(/at least 14 days/);
    expect(turnsOnProblem("smart_assignment_auto", state({ mode: "shadow", shadowRanLongEnough: true }), cited)).toBeNull();
    expect(turnsOnProblem("smart_assignment_auto", state({ mode: "auto", shadowRanLongEnough: true }), cited)).toMatch(/already automatic/);
  });
  it("propose refuses any turn-on when the state is unknown", async () => {
    const out = await run(world(), { assignment: null, changes: [{ ...good, turnsOn: "smart_assignment_shadow", evidenceRefs: [...good.evidenceRefs, "assign.state"] }] });
    expect(out.kind).toBe("none");
    expect(out.dropped[0].reason).toMatch(/unknown/);
  });
});
