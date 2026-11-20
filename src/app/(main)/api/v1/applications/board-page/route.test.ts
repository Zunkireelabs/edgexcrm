import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { encodeFilterTree } from "@/lib/filters/serialize";
import type { FakeSupabase } from "@/industries/education-consultancy/features/application-tracking/lib/__test__/fake-postgrest";
import {
  APPS, AUTH, ME, S1, S2, S3, meCanSee, seedDb,
} from "@/industries/education-consultancy/features/application-tracking/lib/__test__/applications-api-seed";

// EDGEX-141 Phase 3, B4: GET /api/v1/applications/board-page.

const state = vi.hoisted(() => ({ auth: null as unknown, db: null as unknown }));
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: async () => state.auth }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (industry: string | null) => industry === "education_consultancy" }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db, createClient: async () => state.db }));
vi.mock("@/lib/leads/visibility-query", () => ({ visibleLeadsBase: (c: { user: FakeSupabase }) => c.user.from("visible_leads").select() }));

import { GET } from "./route";

type Body = { data: { cards: { id: string }[]; total: number; hasMore: boolean; offset: number; truncated: boolean; filterError: string | null }; error?: { message: string } };
const call = async (qs: string) => {
  const res = await GET(new Request(`http://localhost/api/v1/applications/board-page?${qs}`) as unknown as NextRequest);
  return { status: res.status, body: (await res.json()) as Body };
};
const column = (stage: string, sortKey: "stage_changed_at" = "stage_changed_at") =>
  APPS.filter((a) => a.stage_id === stage).sort((a, b) => (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : a.id < b.id ? -1 : 1)).map((a) => a.id);

beforeEach(() => {
  state.db = seedDb();
  state.auth = AUTH.admin;
});

describe("GET /api/v1/applications/board-page", () => {
  it("paging boundaries: offset 0, 24, 25 and the last page", async () => {
    const all = column(S1);
    const first = await call(`stage=${S1}&offset=0`);
    expect(first.status).toBe(200);
    expect(first.body.data.cards.map((c) => c.id)).toEqual(all.slice(0, 25));
    expect(first.body.data).toMatchObject({ total: all.length, hasMore: true, offset: 0 });
    expect((await call(`stage=${S1}&offset=24`)).body.data.cards.map((c) => c.id)).toEqual(all.slice(24, 49));
    expect((await call(`stage=${S1}&offset=25`)).body.data.cards.map((c) => c.id)).toEqual(all.slice(25, 50));
    const lastOffset = Math.floor((all.length - 1) / 25) * 25;
    const last = await call(`stage=${S1}&offset=${lastOffset}`);
    expect(last.body.data.cards.map((c) => c.id)).toEqual(all.slice(lastOffset));
    expect(last.body.data.hasMore).toBe(false);
    const past = await call(`stage=${S1}&offset=${all.length + 10}`);
    expect(past.body.data).toMatchObject({ cards: [], hasMore: false, total: all.length });
  });

  it("the stage param picks one column; no stage = the flat list (limit up to 50)", async () => {
    const s2 = await call(`stage=${S2}&offset=0&limit=50`);
    expect(s2.body.data.cards.every((c) => APPS.find((a) => a.id === c.id)!.stage_id === S2)).toBe(true);
    const flat = await call("offset=0&limit=50");
    expect(flat.body.data.total).toBe(APPS.length);
    expect(flat.body.data.cards).toHaveLength(50);
    expect(new Set(flat.body.data.cards.map((c) => APPS.find((a) => a.id === c.id)!.stage_id)).size).toBeGreaterThan(1);
  });

  it("Phase 4: the list (no stage) allows 100 per page and returns the footer summary; columns stay capped at 50", async () => {
    const flat = await call("offset=0&limit=100");
    expect(flat.status).toBe(200);
    expect(flat.body.data.cards).toHaveLength(Math.min(100, APPS.length));
    const summary = (flat.body.data as unknown as { summary: { applications: number } }).summary;
    expect(summary.applications).toBe(APPS.length);
    const col = await call(`stage=${S1}&offset=0`);
    expect((col.body.data as unknown as { summary: unknown }).summary).toBeNull();
  });

  it("bad params are a 400, never a 500", async () => {
    for (const qs of ["offset=-1", "offset=abc", "offset=1.5", "limit=0", "limit=101", `stage=${S1}&limit=51`, "stage=not-a-stage"]) {
      expect((await call(qs)).status, qs).toBe(400);
    }
  });

  it("an invalid tree gives the page's friendly message (200 + filterError, same fallback as the page)", async () => {
    const orTree = { conjunction: "or", conditions: [{ id: "c", field: "counsellor", op: "is_any_of", value: [ME] }, { id: "d", field: "intake", op: "is", value: "x" }] };
    const r = await call(`f=${encodeFilterTree(orTree as never)}&stage=${S1}`);
    expect(r.status).toBe(200);
    expect(r.body.data.filterError).toBe("Counsellor can't be combined with OR yet");
    expect(r.body.data.total).toBe(column(S1).length);
    const garbage = await call(`f=%%%not-base64&stage=${S1}`);
    expect(garbage.status).toBe(200);
    expect(garbage.body.data.filterError).toBe("That filter couldn't be read, so it was reset.");
  });

  it("a scope violation can't leak: an own-scope counsellor never sees an app outside scope at any offset", async () => {
    state.auth = AUTH.counsellor;
    const seen = new Set<string>();
    for (const stage of [S1, S2, S3]) {
      for (let offset = 0; ; offset += 25) {
        const r = await call(`stage=${stage}&offset=${offset}`);
        expect(r.status).toBe(200);
        r.body.data.cards.forEach((c) => seen.add(c.id));
        if (!r.body.data.hasMore) break;
      }
    }
    const allowed = new Set(APPS.filter((_, i) => meCanSee(i)).map((a) => a.id));
    expect([...seen].every((id) => allowed.has(id))).toBe(true);
    expect(seen.size).toBe(allowed.size);
    // Even an out-of-range offset into another column returns nothing from outside the scope.
    const r = await call(`offset=0&limit=50`);
    expect(r.body.data.total).toBe(allowed.size);
  });

  it("feature gate and auth: 401 without a session, 403 outside education", async () => {
    state.auth = null;
    expect((await call("offset=0")).status).toBe(401);
    state.auth = { ...AUTH.admin, industryId: "it_agency" };
    expect((await call("offset=0")).status).toBe(403);
  });
});
