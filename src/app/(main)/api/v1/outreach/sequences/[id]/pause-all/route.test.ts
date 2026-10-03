import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/v1/outreach/sequences/[id]/pause-all — the sequence-level emergency stop. Pins: admin only; "pause"
// touches only ACTIVE enrollments and marks them 'sequence_paused'; "resume" touches only the ones that
// marker froze (never a lead paused because they replied, nor a rep's own pause); unknown sequence -> 404.

const authMock = vi.fn();
const featureMock = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
let enrollments: Row[];
let sequenceExists = true;
const emitMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: () => authMock(),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (...a: unknown[]) => featureMock(...a) }));
vi.mock("@/lib/api/audit", () => ({ emitEvent: (...a: unknown[]) => emitMock(...a) }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    from(table: string) {
      if (table === "email_sequences") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: sequenceExists ? { id: "s1" } : null }) }) }) };
      }
      const make = (mode: "select" | "update", patch?: Row, head?: boolean) => {
        const eqs: Array<[string, unknown]> = [];
        const isNull: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          eq(c: string, v: unknown) {
            eqs.push([c, v]);
            return b;
          },
          is(c: string) {
            isNull.push(c);
            return b;
          },
          select() {
            return b;
          },
          then(resolve: (v: unknown) => void) {
            const hit = enrollments.filter((r) => eqs.every(([c, v]) => r[c] === v) && isNull.every((c) => r[c] == null));
            if (mode === "update") hit.forEach((r) => Object.assign(r, patch));
            resolve(head ? { count: hit.length, data: null, error: null } : { data: hit.map((r) => ({ id: r.id })), error: null });
          },
        };
        return b;
      };
      return {
        select: (_c?: string, opts?: { head?: boolean }) => make("select", undefined, opts?.head),
        update: (patch: Row) => make("update", patch),
      };
    },
  }),
}));

import { GET, POST } from "./route";
import type { NextRequest } from "next/server";

const admin = { userId: "u1", tenantId: "t1", role: "admin", industryId: "education_consultancy" };
const post = (body: unknown) => POST({ json: async () => body } as unknown as NextRequest, { params: Promise.resolve({ id: "s1" }) });
const status = () => enrollments.map((e) => `${e.status}/${e.stop_reason ?? "-"}`);

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(admin);
  featureMock.mockReset().mockReturnValue(true);
  emitMock.mockReset();
  sequenceExists = true;
  enrollments = [
    { id: "a1", sequence_id: "s1", status: "active", stop_reason: null },
    { id: "a2", sequence_id: "s1", status: "active", stop_reason: null },
    { id: "r1", sequence_id: "s1", status: "paused", stop_reason: "replied" },
    { id: "m1", sequence_id: "s1", status: "paused", stop_reason: null },
    { id: "x1", sequence_id: "OTHER", status: "active", stop_reason: null },
    { id: "d1", sequence_id: "s1", status: "completed", stop_reason: null },
  ];
});

describe("pause-all", () => {
  it("401 signed out, 403 for a non-admin and for a tenant without Outreach", async () => {
    authMock.mockResolvedValue(null);
    expect((await post({ action: "pause" })).status).toBe(401);
    authMock.mockResolvedValue({ ...admin, role: "viewer" });
    expect((await post({ action: "pause" })).status).toBe(403);
    authMock.mockResolvedValue(admin);
    featureMock.mockReturnValue(false);
    expect((await post({ action: "pause" })).status).toBe(403);
    expect(status()).toEqual(["active/-", "active/-", "paused/replied", "paused/-", "active/-", "completed/-"]);
  });

  it("422 for an unknown action, 404 for an unknown sequence", async () => {
    expect((await post({ action: "stop" })).status).toBe(422);
    sequenceExists = false;
    expect((await post({ action: "pause" })).status).toBe(404);
  });

  it("pause: freezes only this sequence's ACTIVE enrollments and marks them", async () => {
    const res = await post({ action: "pause" });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ action: "pause", affected: 2 });
    expect(status()).toEqual(["paused/sequence_paused", "paused/sequence_paused", "paused/replied", "paused/-", "active/-", "completed/-"]);
    expect(emitMock).toHaveBeenCalledWith(expect.objectContaining({ type: "sequence.paused_all", entityId: "s1" }));
  });

  it("resume: restarts ONLY the ones Pause all froze — not a replied lead, not a rep's own pause", async () => {
    await post({ action: "pause" });
    const res = await post({ action: "resume" });

    expect((await res.json()).data).toEqual({ action: "resume", affected: 2 });
    expect(status()).toEqual(["active/-", "active/-", "paused/replied", "paused/-", "active/-", "completed/-"]);
  });

  it("GET gives the numbers the confirm dialog shows", async () => {
    await post({ action: "pause" });
    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "s1" }) });
    expect((await res.json()).data).toEqual({ active: 0, paused_by_stop_all: 2, paused_other: 2 });
  });
});
