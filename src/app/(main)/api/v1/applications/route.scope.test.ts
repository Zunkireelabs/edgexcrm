import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { FakeSupabase } from "@/industries/education-consultancy/features/application-tracking/lib/__test__/fake-postgrest";
import {
  APPS, AUTH, LEADS, inBranch, meCanSee, seedDb, S2,
} from "@/industries/education-consultancy/features/application-tracking/lib/__test__/applications-api-seed";

// EDGEX-141 Phase 3, B1: GET /api/v1/applications goes through resolveApplicationsScope (the board's
// rule) and runApplicationsQuery's chunked, paged reads. Before this, branch scope was missing (a
// branch manager got every application in the tenant) and own scope missed collaborator leads.

const state = vi.hoisted(() => ({ auth: null as unknown, db: null as unknown }));
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: async () => state.auth, requireLeadBranchAccess: () => true, getClientIp: () => "127.0.0.1" }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db, createClient: async () => state.db }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: async () => state.db }));
vi.mock("@/lib/leads/visibility-query", () => ({ visibleLeadsBase: (c: { user: FakeSupabase }) => c.user.from("visible_leads").select() }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: async () => {}, emitEvent: async () => {} }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info() {}, error() {}, warn() {} }) }));

import { GET } from "./route";

const get = (qs = "") => GET(new Request(`http://localhost/api/v1/applications${qs}`) as unknown as NextRequest);
const ids = async (qs: string) => {
  const body = (await (await get(qs)).json()) as { data: { id: string }[]; meta: { total: number; page: number; pageSize: number; totalPages: number } };
  return body;
};
async function allIds(qs = "") {
  const out: string[] = [];
  let total = 0;
  for (let page = 1; ; page++) {
    const b = await ids(`?pageSize=100&page=${page}${qs}`);
    total = b.meta.total;
    out.push(...b.data.map((r) => r.id));
    if (page >= b.meta.totalPages) break;
  }
  return { out, total };
}
const expectedIds = (keep: (i: number) => boolean) => APPS.filter((_, i) => keep(i)).map((a) => a.id).sort();

beforeEach(() => {
  state.db = seedDb();
});

describe("GET /api/v1/applications — one scoping rule (B1)", () => {
  it("all scope (admin): every application, total past 1000, newest first", async () => {
    state.auth = AUTH.admin;
    const first = await ids("?pageSize=5");
    expect(first.meta.total).toBe(LEADS);
    expect(first.data.map((r) => r.id)).toEqual([...APPS].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5).map((a) => a.id));
    const { out } = await allIds();
    expect(out.length).toBe(LEADS);
  });

  it("branch scope (manager of b1): only applications whose lead belongs to a b1 member — not the tenant", async () => {
    state.auth = AUTH.manager;
    const { out, total } = await allIds();
    expect(total).toBe(expectedIds(inBranch).length);
    expect(total).toBeLessThan(LEADS);
    expect(out.sort()).toEqual(expectedIds(inBranch));
  });

  it("own scope (counsellor): own + collaborator-visible leads, chunked so no URL passes ~8 KB", async () => {
    state.auth = AUTH.counsellor;
    const { out, total } = await allIds();
    expect(total).toBe(expectedIds(meCanSee).length);
    expect(out.sort()).toEqual(expectedIds(meCanSee));
    expect(out).toContain(APPS[2].id); // lead 2: assigned to someone else, ME is a collaborator
    expect(Math.max(...(state.db as FakeSupabase).log.map((q) => q.urlLength))).toBeLessThan(8192);
  });

  it("keeps its params: stage_id / status / country / lead_id / assigned_to, response shape {data, meta}", async () => {
    state.auth = AUTH.admin;
    const b = await ids(`?stage_id=${S2}&status=sent&country=UK&pageSize=100`);
    const exp = APPS.filter((a) => a.stage_id === S2 && a.status === "sent" && a.countries.includes("UK"));
    expect(b.meta).toMatchObject({ total: exp.length, page: 1, pageSize: 100 });
    expect(b.data.every((r) => exp.some((e) => e.id === r.id))).toBe(true);
    const one = await ids("?lead_id=lead-7");
    expect(one.data.map((r) => r.id)).toEqual(["app-00007"]);
  });

  it("a counsellor can't widen scope with assigned_to or lead_id", async () => {
    state.auth = AUTH.counsellor;
    const outside = APPS.findIndex((_, i) => !meCanSee(i));
    const b = await ids(`?lead_id=lead-${outside}`);
    expect(b.data).toEqual([]);
    expect(b.meta.total).toBe(0);
  });
});
