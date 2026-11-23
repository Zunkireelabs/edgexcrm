import { describe, expect, it, vi } from "vitest";
import { encodeFilterTree } from "@/lib/filters/serialize";
import { normalizeDestinations } from "@/lib/leads/destination-normalize";
import type { CompileCtx, FilterTree } from "@/lib/filters/types";
import type { ApplicationPipeline, ApplicationStage } from "@/types/database";
import { createFakeSupabase } from "./__test__/fake-postgrest";
import { loadBoardPage, loadBoardSlice, type BoardMeta } from "./board-load";
import { APPLICATION_SORTS, runApplicationsQuery, type ApplicationSort, type ApplicationsScope } from "./applications-query";
import { COLUMN_PAGE_SIZE, LIST_PAGE_SIZES, deadlineTone, summarizeIndex, ymdInTz, type IndexRow } from "./board-index";

// EDGEX-141 Phase 3, B6: the 1000-row cap is gone. 2,500 applications through the REAL loaders, on a
// fake PostgREST that silently caps every response at 1000 rows like the real server. Every expected
// number is brute-forced over the seed with independent code (no board helpers).

const T = "tenant-1";
const NOW = new Date("2026-06-01T12:00:00.000Z");
const DAY = 86_400_000;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = uuid(1);
const TEAM = [ME, uuid(2), uuid(3), uuid(4), uuid(5)];
const P1 = uuid(101); // default
const P2 = uuid(102);
const iso = (ms: number) => new Date(ms).toISOString();

const st = (n: number, pipeline: string, position: number, finished = false): ApplicationStage =>
  ({
    id: uuid(200 + n), tenant_id: T, pipeline_id: pipeline, name: `Stage ${n}`, slug: `s${n}`, position, color: "#999",
    is_default: position === 0, is_terminal: finished, terminal_type: finished ? "won" : null, created_at: "", updated_at: "",
  }) as ApplicationStage;
const P1_STAGES = [st(1, P1, 0), st(2, P1, 1), st(3, P1, 2), st(4, P1, 3), st(5, P1, 4, true)];
const P2_STAGES = [st(6, P2, 0), st(7, P2, 1), st(8, P2, 2, true)];
const STAGES = [...P1_STAGES, ...P2_STAGES];
const FINISHED = new Set(STAGES.filter((s) => s.is_terminal).map((s) => s.id));
const PIPELINE_OF = new Map(STAGES.map((s) => [s.id, s.pipeline_id!]));
const PIPELINES = [
  { id: P1, tenant_id: T, name: "Default", slug: "default", is_default: true, position: 0, is_active: true, created_at: "", updated_at: "" },
  { id: P2, tenant_id: T, name: "Fast", slug: "fast", is_default: false, position: 1, is_active: true, created_at: "", updated_at: "" },
] as ApplicationPipeline[];
const META: BoardMeta = { stages: STAGES, pipelines: PIPELINES };

const UNIS = ["Harvard University", "University of Melbourne", "UCL", "University of Toronto", "TU Munich", "Yale University", "Monash University"];
const PROGS = ["MSc Computer Science", "MBA", "LLM", "BSc Nursing", null];
const NAMES = [["Sam", "Lee"], ["Ann", "Harvard-Smith"], ["Harvey", "Specter"], ["Mina", "Rai"], ["Joel", "Adhikari"]];
const COUNTRIES = [["UK"], ["Australia"], ["Canada"], ["USA", "Canada"], []];
const INTAKES = ["Fall 2026", "Spring 2027", null];

interface Seed {
  id: string; tenant_id: string; lead_id: string; assigned_to: string | null; university_name: string; program_name: string | null;
  intake_term: string | null; countries: string[]; offer_type: string | null; pipeline_id: string | null; stage_id: string;
  stage_changed_at: string; created_at: string; updated_at: string; application_deadline: string | null; deleted_at: null; status: string;
  leads: { id: string; first_name: string; last_name: string; email: string; assigned_to: string | null; deleted_at: null };
}

const N = 2500;
const SEED: Seed[] = Array.from({ length: N }, (_, i) => {
  const inP2 = i % 4 === 3;
  const stages = inP2 ? P2_STAGES : P1_STAGES;
  const stage = stages[i % stages.length];
  const [fn, ln] = NAMES[i % NAMES.length];
  return {
    id: `app-${String((i * 7919) % 100000).padStart(5, "0")}-${i}`, // ids not in seed order
    tenant_id: T, lead_id: `lead-${i}`,
    assigned_to: i % 3 === 0 ? TEAM[i % 5] : null,
    university_name: UNIS[i % UNIS.length], program_name: PROGS[i % PROGS.length],
    intake_term: INTAKES[i % INTAKES.length], countries: COUNTRIES[i % COUNTRIES.length], offer_type: i % 6 === 0 ? "conditional" : null,
    pipeline_id: i % 23 === 0 ? null : stage.pipeline_id, stage_id: stage.id,
    // Few distinct values -> many ties: every sort must fall back to id.
    stage_changed_at: iso(NOW.getTime() - ((i * 13) % 61) * DAY),
    created_at: iso(NOW.getTime() - ((i * 7) % 90) * DAY), updated_at: iso(NOW.getTime() - (i % 17) * DAY),
    application_deadline: i % 5 === 0 ? null : iso(NOW.getTime() + ((i * 3) % 40) * DAY),
    deleted_at: null, status: "x",
    leads: { id: `lead-${i}`, first_name: fn, last_name: ln, email: `s${i}@x.test`, assigned_to: i % 2 === 0 ? TEAM[(i + 1) % 5] : null, deleted_at: null },
  };
});

// ── brute force (independent of the board code) ──────────────────────────────────────────────
const counsellorOf = (a: Seed) => a.assigned_to ?? a.leads.assigned_to;
const pipelineOf = (a: Seed) => PIPELINE_OF.get(a.stage_id)!;
const CUTOFF = NOW.getTime() - 30 * DAY;
const isStuckTab = (a: Seed) => new Date(a.stage_changed_at).getTime() < CUTOFF && !FINISHED.has(a.stage_id);
const contains = (v: string | null, q: string) => !!v && v.toLowerCase().includes(q.toLowerCase());
const matchesSearch = (a: Seed, q: string) =>
  contains(a.university_name, q) || contains(a.program_name, q) ||
  q.trim().split(/\s+/).every((w) => contains(a.leads.first_name, w) || contains(a.leads.last_name, w));
function bruteSort(rows: Seed[], sort: ApplicationSort): Seed[] {
  const c = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return [...rows].sort((a, b) => {
    let p = 0;
    const dl = (desc: boolean) =>
      a.application_deadline === b.application_deadline ? 0 : !a.application_deadline ? 1 : !b.application_deadline ? -1
        : desc ? c(b.application_deadline, a.application_deadline) : c(a.application_deadline, b.application_deadline);
    if (sort === "newest") p = c(b.created_at, a.created_at);
    else if (sort === "created_asc") p = c(a.created_at, b.created_at);
    else if (sort === "updated") p = c(b.updated_at, a.updated_at);
    else if (sort === "updated_asc") p = c(a.updated_at, b.updated_at);
    else if (sort === "university") p = c(a.university_name.toLowerCase(), b.university_name.toLowerCase());
    else if (sort === "university_desc") p = c(b.university_name.toLowerCase(), a.university_name.toLowerCase());
    else if (sort === "deadline") p = dl(false);
    else if (sort === "deadline_desc") p = dl(true);
    else if (sort === "stage_asc") p = c(b.stage_changed_at, a.stage_changed_at);
    else p = c(a.stage_changed_at, b.stage_changed_at);
    return p || c(a.id, b.id);
  });
}
const countBy = (rows: Seed[], key: (a: Seed) => string | null) => {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r);
    if (k) m[k] = (m[k] ?? 0) + 1;
  }
  return m;
};

// ── harness ───────────────────────────────────────────────────────────────────────────────
const ctx: CompileCtx = { tz: "UTC", now: NOW, industryId: "education_consultancy", permissions: {} };
const ALL: ApplicationsScope = { leadIds: null, teamMemberIds: null };
const and = (...conditions: FilterTree["conditions"]): FilterTree => ({ conjunction: "and", conditions });
const counsellorChip = (id: string) => and({ id: "c", field: "counsellor", op: "is_any_of", value: [id] });

function db(maxRows = 1000) {
  return createFakeSupabase({ applications: SEED as never, applicant_documents: [], tasks: [] }, { maxRows });
}
async function page(params: Record<string, string>, scope = ALL) {
  const supabase = db();
  const r = await loadBoardPage({ supabase: supabase as never, tenantId: T, userId: ME, scope, ctx, params, meta: META });
  return { ...r, log: supabase.log };
}

describe("B6: board numbers over 2,500 apps equal brute force (fake server caps at 1000)", () => {
  it("the fake really caps an unpaged read at 1000 (so a capped reader would fail these tests)", async () => {
    const { data } = await db().from("applications").select("*");
    expect((data as unknown[]).length).toBe(1000);
  });

  it("unfiltered: tab counts, of T, stage + pipeline totals and facets", async () => {
    const r = await page({});
    const onP1 = SEED.filter((a) => pipelineOf(a) === P1);
    expect(r.board.total).toBe(onP1.length);
    expect(r.board.truncated).toBe(false);
    expect(r.totals.tabCounts).toEqual({
      all: onP1.length,
      mine: onP1.filter((a) => counsellorOf(a) === ME).length,
      stuck: onP1.filter(isStuckTab).length,
    });
    expect(r.totals.pipelineTotals).toEqual({ [P1]: onP1.length, [P2]: N - onP1.length });
    expect(r.totals.noPipelineTotal).toBe(SEED.filter((a) => a.pipeline_id === null && pipelineOf(a) === P1).length);
    expect(r.totals.stageTotals).toEqual(countBy(SEED, (a) => a.stage_id));
    expect(r.totals.facets.counsellor).toEqual(countBy(onP1, counsellorOf));
    expect(r.totals.facets.stage).toEqual(countBy(onP1, (a) => a.stage_id));
    expect(r.totals.facets.intake).toEqual(countBy(onP1, (a) => a.intake_term));
    expect(r.totals.facets.offer_type).toEqual(countBy(onP1, (a) => a.offer_type));
    const country: Record<string, number> = {};
    for (const a of onP1) for (const c of normalizeDestinations(a.countries)) country[c] = (country[c] ?? 0) + 1;
    expect(r.totals.facets.country).toEqual(country);
    for (const s of P1_STAGES) expect(r.board.columns[s.id].total).toBe(onP1.filter((a) => a.stage_id === s.id).length);
    // M3: an unfiltered load is ONE index read (3 pages: 1000 + 1000 + 500), not two, plus ONE card
    // read (4 active columns x 25 = 100 ids = one chunk).
    const apps = r.log.filter((q) => q.table === "applications");
    expect(apps.map((q) => q.rows)).toEqual([1000, 1000, 500, 100]);
  });

  const cases: { name: string; params: Record<string, string>; keep: (a: Seed) => boolean }[] = [
    { name: "Counsellor chip", params: { f: encodeFilterTree(counsellorChip(TEAM[1])) }, keep: (a) => counsellorOf(a) === TEAM[1] },
    { name: "search", params: { q: "harv" }, keep: (a) => matchesSearch(a, "harv") },
    { name: "Counsellor + search", params: { f: encodeFilterTree(counsellorChip(TEAM[2])), q: "harv" }, keep: (a) => counsellorOf(a) === TEAM[2] && matchesSearch(a, "harv") },
    { name: "Stuck tab", params: { tab: "stuck" }, keep: isStuckTab },
    { name: "My tab", params: { tab: "mine" }, keep: (a) => counsellorOf(a) === ME },
  ];
  for (const c of cases) {
    it(`filtered (${c.name}): every column count and "N" equal brute force; "of T" stays unfiltered`, async () => {
      const r = await page(c.params);
      const onP1 = SEED.filter((a) => pipelineOf(a) === P1);
      const hit = onP1.filter(c.keep);
      expect(hit.length).toBeGreaterThan(0);
      expect(r.board.total).toBe(hit.length);
      for (const s of P1_STAGES) {
        expect(r.board.columns[s.id].total).toBe(hit.filter((a) => a.stage_id === s.id).length);
        expect(r.board.columns[s.id].stuck).toBe(FINISHED.has(s.id) ? 0 : hit.filter((a) => a.stage_id === s.id && new Date(a.stage_changed_at).getTime() <= CUTOFF).length);
      }
      expect(r.totals.tabCounts?.all).toBe(onP1.length);
    });
  }

  for (const sort of APPLICATION_SORTS) {
    it(`first page of every active column is the right 25 (sort: ${sort})`, async () => {
      const r = await page(sort === "stage" ? {} : { sort });
      for (const s of P1_STAGES) {
        const expected = bruteSort(SEED.filter((a) => a.stage_id === s.id), sort).slice(0, COLUMN_PAGE_SIZE).map((a) => a.id);
        const got = r.board.columns[s.id].cards.map((a) => a.id);
        // Finished columns start collapsed: count only, no cards until expanded.
        expect(got).toEqual(FINISHED.has(s.id) ? [] : expected);
      }
    });
  }

  it("paging every column of both pipelines through board-page returns each app exactly once", async () => {
    const seen: string[] = [];
    for (const [pipeline, stages] of [[P1, P1_STAGES], [P2, P2_STAGES]] as const) {
      for (const s of stages) {
        for (let offset = 0; ; offset += COLUMN_PAGE_SIZE) {
          const r = await loadBoardSlice({
            supabase: db() as never, tenantId: T, userId: ME, scope: ALL, ctx, meta: META,
            params: { pipeline, sort: "newest" }, stage: s.id, offset, limit: COLUMN_PAGE_SIZE,
          });
          if (!r.ok) throw new Error(r.message);
          seen.push(...r.cards.map((a) => a.id));
          if (!r.hasMore) break;
        }
      }
    }
    expect(seen.length).toBe(N);
    expect(new Set(seen).size).toBe(N);
  });

  it("over the row ceiling: logs, returns what it has, sets truncated (header shows N+)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await runApplicationsQuery({ supabase: db() as never, tenantId: T, scope: ALL, tree: and(), ctx, mode: "rows", maxRows: 1500 });
    expect(res.ok && res.mode === "rows" && res.truncated).toBe(true);
    expect(res.ok && res.mode === "rows" && res.rows.length).toBeGreaterThanOrEqual(1500);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("row ceiling"), expect.anything());
    const full = await runApplicationsQuery({ supabase: db() as never, tenantId: T, scope: ALL, tree: and(), ctx, mode: "rows" });
    expect(full.ok && full.mode === "rows" && [full.rows.length, full.truncated]).toEqual([N, false]);
    spy.mockRestore();
  });

  it("a short page (exactly 1000) is not mistaken for the end", async () => {
    const res = await runApplicationsQuery({ supabase: db() as never, tenantId: T, scope: ALL, tree: and(), ctx, mode: "rows" });
    expect(res.ok && res.mode === "rows" && res.rows.length).toBe(N);
  });
});

// ── Phase 4: the List view pages the FLAT filtered index; its footer summarises the same index ────
describe("Phase 4 list view over 2,500 apps", () => {
  async function listPage(params: Record<string, string>, offset: number, limit: number) {
    const r = await loadBoardSlice({ supabase: db() as never, tenantId: T, userId: ME, scope: ALL, ctx, meta: META, params, stage: null, offset, limit });
    if (!r.ok) throw new Error(r.message);
    return r;
  }
  const onP1 = () => SEED.filter((a) => pipelineOf(a) === P1);
  const listCases: { name: string; params: Record<string, string>; keep: (a: Seed) => boolean; sort: ApplicationSort }[] = [
    { name: "unfiltered", params: {}, keep: () => true, sort: "stage" },
    { name: "Counsellor chip, University Z-A", params: { f: encodeFilterTree(counsellorChip(TEAM[1])), sort: "university_desc" }, keep: (a) => counsellorOf(a) === TEAM[1], sort: "university_desc" },
    { name: "search, deadline latest", params: { q: "harv", sort: "deadline_desc" }, keep: (a) => matchesSearch(a, "harv"), sort: "deadline_desc" },
    { name: "Stuck tab, shortest in stage", params: { tab: "stuck", sort: "stage_asc" }, keep: isStuckTab, sort: "stage_asc" },
  ];

  for (const c of listCases) {
    for (const size of LIST_PAGE_SIZES) {
      it(`pages of ${size} tile the filtered index exactly once, in brute-force order (${c.name})`, async () => {
        const expected = bruteSort(onP1().filter(c.keep), c.sort).map((a) => a.id);
        const seen: string[] = [];
        const pages = Math.max(1, Math.ceil(expected.length / size));
        for (let p = 1; p <= pages; p++) {
          const r = await listPage(c.params, (p - 1) * size, size);
          expect(r.total).toBe(expected.length);
          // every page but the last is full; the last holds the remainder
          expect(r.cards.length).toBe(p < pages ? size : expected.length - (pages - 1) * size);
          expect(r.hasMore).toBe(p < pages);
          seen.push(...r.cards.map((a) => a.id));
        }
        expect(seen).toEqual(expected);
        // one past the last page is empty, never a repeat
        const past = await listPage(c.params, pages * size, size);
        expect(past.cards).toEqual([]);
      });
    }

    it(`footer summaries equal brute force over the filtered index (${c.name})`, async () => {
      const hit = onP1().filter(c.keep);
      const r = await listPage(c.params, 0, 25);
      const days = hit.map((a) => Math.floor((NOW.getTime() - new Date(a.stage_changed_at).getTime()) / DAY)).sort((x, y) => x - y);
      const m = days.length >> 1;
      const today = NOW.toISOString().slice(0, 10);
      const dayDiff = (d: string) => Math.round((Date.parse(`${d.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
      expect(r.summary).toEqual({
        applications: hit.length,
        universities: new Set(hit.map((a) => a.university_name.toLowerCase())).size,
        stages: new Set(hit.map((a) => a.stage_id)).size,
        medianDaysInStage: days.length === 0 ? null : days.length % 2 ? days[m] : Math.floor((days[m - 1] + days[m]) / 2),
        counsellors: new Set(hit.map(counsellorOf).filter(Boolean)).size,
        dueSoon: hit.filter((a) => a.application_deadline && dayDiff(a.application_deadline) >= 0 && dayDiff(a.application_deadline) <= 14).length,
      });
    });
  }

  it("list cards carry the stage the board places them in", async () => {
    const r = await listPage({}, 0, 100);
    const seed = new Map(SEED.map((a) => [a.id, a]));
    expect(r.cards.length).toBe(100);
    for (const c of r.cards) expect(c.placed_stage_id).toBe(seed.get(c.id)!.stage_id);
  });

  it("a column page carries no list summary", async () => {
    const r = await loadBoardSlice({ supabase: db() as never, tenantId: T, userId: ME, scope: ALL, ctx, meta: META, params: {}, stage: P1_STAGES[0].id, offset: 0, limit: 25 });
    expect(r.ok && r.summary).toBe(null);
  });

  it("due-in-14d counts in the TENANT timezone, not UTC (boundaries included)", () => {
    // 2026-06-01T12:00Z is already 2026-06-02 in Pacific/Kiritimati (UTC+14).
    const row = (id: string, deadline: string | null) =>
      ({ id, application_deadline: deadline, university_name: "U", stage_changed_at: NOW.toISOString(), assigned_to: null, leads: null }) as unknown as IndexRow;
    const flat = [row("a", "2026-06-01"), row("b", "2026-06-15"), row("c", "2026-06-16"), row("d", null), row("e", "2026-05-31")];
    const index = { flat, byStage: { s: flat }, stuckByStage: {} };
    // UTC today = 06-01: 06-01 (day 0) and 06-15 (day 14) count; 06-16 is day 15; 05-31 is past.
    expect(summarizeIndex(index, { tz: "UTC", nowMs: NOW.getTime() }).dueSoon).toBe(2);
    // Kiritimati today = 06-02: 06-01 is past; 06-15 and 06-16 count.
    expect(summarizeIndex(index, { tz: "Pacific/Kiritimati", nowMs: NOW.getTime() }).dueSoon).toBe(2);
    expect(deadlineTone("2026-06-01", ymdInTz(NOW.getTime(), "Pacific/Kiritimati"))).toBe("past");
    expect(deadlineTone("2026-06-01", ymdInTz(NOW.getTime(), "UTC"))).toBe("soon");
    expect(deadlineTone("2026-06-16", ymdInTz(NOW.getTime(), "UTC"))).toBe("neutral");
    expect(deadlineTone(null, "2026-06-01")).toBe("none");
    // an unknown zone falls back to UTC rather than throwing
    expect(ymdInTz(NOW.getTime(), "Not/AZone")).toBe("2026-06-01");
  });
});
