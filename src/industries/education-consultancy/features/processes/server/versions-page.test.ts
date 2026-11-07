import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(async () => undefined) }));
vi.mock("../../home/server/assignment/settings", () => ({ loadAssignmentSettings: async () => ({ mode: "off" }) }));
vi.mock("../../pulse/server/context", () => ({ loadUserNames: async () => new Map([["u1", { name: "Manish" }], ["u2", { name: "Asha" }]]) }));

import { buildBaselineSpec } from "../lib/baseline";
import { ADMIZZ_NEW_LEAD_RAW, ADMIZZ_SETUP } from "../lib/fixtures";
import { loadDraft } from "./changes";
import { loadProcessViews } from "./load-processes";
import { loadImprovementLog, loadVersionsPage } from "./compare";

const KEY = "new_lead_first_call" as const;
const spec = buildBaselineSpec(KEY, ADMIZZ_SETUP);
const NOW = new Date("2026-11-12T11:00:00Z");

/** A table-aware fake: a query on a table resolves to its rows, narrowed by `.eq()` / `.in()`; `.maybeSingle()` gives the first row. */
function ctx(tables: Record<string, unknown[]>, auth = { userId: "u1", role: "owner", tenantId: "t1" }) {
  type Row = Record<string, unknown>;
  const chain = (rows: Row[]): unknown =>
    new Proxy(
      {},
      {
        get: (_t, k) => {
          if (k === "then") return (res: (v: unknown) => void) => res({ data: rows, error: null });
          if (k === "maybeSingle" || k === "single") return async () => ({ data: rows[0] ?? null, error: null });
          if (k === "eq") return (col: string, v: unknown) => chain(rows.filter((r) => r[col] === v));
          if (k === "in") return (col: string, vs: unknown[]) => chain(rows.filter((r) => vs.includes(r[col])));
          return () => chain(rows);
        },
      },
    );
  const db = {
    from: (t: string) => chain((tables[t] ?? []) as Row[]),
    raw: () => ({ rpc: async () => ({ data: ADMIZZ_NEW_LEAD_RAW, error: null }) }),
  };
  return { auth, db, tz: "UTC", tenantName: "Admizz" } as never;
}

const ver = (o: Record<string, unknown>) => ({ id: "v1", process_id: "p1", version: 1, status: "retired", source: "system", spec, approved_by: "u1", approved_at: "2026-11-07T11:00:00Z", created_at: "2026-11-07T10:00:00Z", rejected_at: null, rejected_by: null, rejected_reason: null, change_summary: null, ...o });
const TABLES = {
  processes: [{ id: "p1", key: KEY, name: "New lead → first call", live_version_id: "v2", owner_user_id: "u1" }],
  process_versions: [
    ver({}),
    ver({ id: "v2", version: 2, status: "live", source: "person", approved_at: "2026-11-09T11:00:00Z", change_summary: "First contact: count in working hours" }),
    ver({ id: "v3", version: 3, status: "draft", source: "person", approved_at: null, approved_by: null, created_at: "2026-11-11T10:00:00Z" }),
  ],
  process_changes: [
    { id: "c1", process_id: "p1", version_id: "v2", part: "step:first_contact", field: "target", before: { value: 80, metric: "first_contact_1h_pct" }, after: { value: 80, metric: "first_contact_1wh_pct" }, why: "w", status: "taken", author_kind: "person", author_user_id: "u1", created_at: "2026-11-08T10:00:00Z" },
    { id: "c2", process_id: "p1", version_id: "v2", part: "trigger", field: "wording", before: "a", after: "b", why: "w2", status: "not_taken", author_kind: "person", author_user_id: "u1", created_at: "2026-11-08T11:00:00Z" },
    { id: "c3", process_id: "p1", version_id: "v3", part: "exceptions", field: "wording", before: [], after: ["x"], why: "w3", status: "open", author_kind: "person", author_user_id: "u2", created_at: "2026-11-11T11:00:00Z" },
  ],
  positions: [{ slug: "counselor", name: "Counselor" }],
};

describe("loadVersionsPage", () => {
  it("lists the versions with names and counts, the open draft on top of the live one, and the live version's compare with its changes", async () => {
    const page = await loadVersionsPage(ctx(TABLES), KEY, null, NOW);
    expect(page!.process).toMatchObject({ key: KEY, ownerName: "Manish", canApprove: true });
    expect(page!.versions.map((v) => `${v.version}:${v.status}`)).toEqual(["1:retired", "2:live", "3:draft"]);
    expect(page!.versions[1]).toMatchObject({ approvedByName: "Manish", suggestedBy: "Manish", changeCount: 2, takenCount: 1, summary: "First contact: count in working hours" });
    expect(page!.draft).toEqual({ id: "v3", version: 3, changeCount: 1, suggestedBy: "Asha" });
    expect(page!.compare!.current).toMatchObject({ versionId: "v2", version: 2, daysLive: 3 });
    expect(page!.compare!.previous!.version).toBe(1);
    expect(page!.compare!.measures.length).toBeGreaterThan(0);
    expect(page!.compare!.measures.every((m) => !m.ready)).toBe(true); // 3 days: nothing is trusted yet
    // taken first, not-taken after, with readable titles
    expect(page!.compare!.changes.map((c) => `${c.status}:${c.title}`)).toEqual(["taken:First contact: count in working hours", "not_taken:Trigger: new wording"]);
  });

  it("?version= compares that version; an unknown one has no compare; a draft has none either", async () => {
    expect((await loadVersionsPage(ctx(TABLES), KEY, "v1", NOW))!.compare!.previous).toBeNull(); // v1 has nothing before it
    expect((await loadVersionsPage(ctx(TABLES), KEY, "zzz", NOW))!.compare).toBeNull();
    expect((await loadVersionsPage(ctx(TABLES), KEY, "v3", NOW))!.compare).toBeNull();
  });

  it("with no live version the baseline draft is not an 'open draft on top of live'", async () => {
    const t = { ...TABLES, processes: [{ ...TABLES.processes[0], live_version_id: null }], process_versions: [ver({ status: "draft", approved_at: null, approved_by: null })], process_changes: [] };
    const page = await loadVersionsPage(ctx(t), KEY, null, NOW);
    expect(page!.draft).toBeNull();
    expect(page!.compare).toBeNull();
  });

  it("an admin who isn't the owner can't approve", async () => {
    const page = await loadVersionsPage(ctx(TABLES, { userId: "u9", role: "admin", tenantId: "t1" }), KEY, null, NOW);
    expect(page!.process.canApprove).toBe(false);
  });
});

describe("loadImprovementLog (cheap variant)", () => {
  it("skips '30 days on' (no metrics SQL) and puts readable titles in the suggested rows", async () => {
    const log = await loadImprovementLog(ctx(TABLES), null, new Date("2026-12-20T00:00:00Z"), { measures: false });
    expect(log.some((e) => e.kind === "thirty_days")).toBe(false);
    const sug = log.filter((e) => e.kind === "suggested").map((e) => e.meta);
    expect(sug.some((m) => m.includes("First contact: count in working hours"))).toBe(true);
    expect(log.find((e) => e.kind === "approved" && e.version === 2)!.meta).toContain("1 change: First contact: count in working hours");
  });
  it("the full variant adds '30 days on' with measures", async () => {
    const log = await loadImprovementLog(ctx(TABLES), null, new Date("2026-12-20T00:00:00Z"));
    const t = log.find((e) => e.kind === "thirty_days");
    expect(t?.measures?.length).toBeGreaterThan(0);
  });
});

describe("loadDraft (review page)", () => {
  it("returns readable titles, now/proposed words, the drives line, author names, positions and the viewer", async () => {
    const t = { ...TABLES, process_versions: TABLES.process_versions.map((v) => (v.id === "v3" ? { ...v, spec } : v)) };
    t.process_changes = [
      { id: "c9", process_id: "p1", version_id: "v3", part: "step:first_contact", field: "target", before: { value: 80, metric: "first_contact_1h_pct" }, after: { value: 75, metric: "first_contact_1wh_pct" }, why: "w", evidence: [], status: "open", taken: true, edited_by: "u1", edited_at: "x", author_kind: "person", author_user_id: "u2", created_at: "2026-11-11T11:00:00Z" },
    ] as never;
    const view = await loadDraft(ctx(t), KEY);
    expect(view!.viewerName).toBe("Manish");
    expect(view!.process).toMatchObject({ ownerName: "Manish", canApprove: true });
    expect(view!.positions).toEqual([{ slug: "counselor", name: "Counselor" }]);
    expect(view!.live).toMatchObject({ id: "v2", version: 2 });
    const d = view!.draft!;
    expect(d.authors).toEqual([{ userId: "u2", kind: "person", name: "Asha" }]);
    const c = d.changes[0];
    expect(c).toMatchObject({
      title: "First contact: count in working hours, target 75%",
      stepKey: "first_contact",
      beforeText: "within 1 hour · target 80%",
      afterText: "within 1 working hour · target 75%",
      authorName: "Asha",
      editedByName: "Manish",
    });
    expect(c.drives).toMatch(/uses the new target$/);
  });
  it("no open draft -> draft is null but the process, positions and viewer are still there", async () => {
    const view = await loadDraft(ctx({ ...TABLES, process_versions: TABLES.process_versions.filter((v) => v.status !== "draft") }), KEY);
    expect(view!.draft).toBeNull();
    expect(view!.positions).toHaveLength(1);
  });
});

describe("loadProcessViews: the open draft on top of a live version", () => {
  const withProc = (t: Record<string, unknown[]>) => ({ ...t, processes: [{ ...TABLES.processes[0], created_at: "2026-11-07T10:00:00Z", review_due_at: null }] });
  it("carries the draft id, version and how many changes it holds", async () => {
    const [p] = await loadProcessViews(ctx(withProc(TABLES)), 30);
    expect(p.shown).toMatchObject({ id: "v2", status: "live" });
    expect(p.draft).toEqual({ id: "v3", version: 3, changeCount: 1 });
    expect(p.canApprove).toBe(true);
  });
  it("a baseline-only draft is `shown`, not `draft`; no draft means null", async () => {
    const baseline = { ...withProc(TABLES), processes: [{ ...withProc(TABLES).processes[0], live_version_id: null }], process_versions: [ver({ status: "draft", approved_at: null, approved_by: null })], process_changes: [] };
    const [b] = await loadProcessViews(ctx(baseline), 30);
    expect(b.shown?.status).toBe("draft");
    expect(b.draft).toBeNull();
    const none = { ...withProc(TABLES), process_versions: TABLES.process_versions.filter((v) => v.status !== "draft") };
    expect((await loadProcessViews(ctx(none), 30))[0].draft).toBeNull();
  });
});
