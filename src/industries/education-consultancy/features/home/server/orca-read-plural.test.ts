import { describe, it, expect, vi, beforeEach } from "vitest";

const { writeMock, upserts } = vi.hoisted(() => ({ writeMock: vi.fn(), upserts: [] as unknown[] }));
vi.mock("@/lib/api/auth", () => ({}));
vi.mock("@/lib/supabase/queries", () => ({ getBranches: async () => [] }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: async () => ({ from: () => ({ upsert: async (v: unknown) => (upserts.push(v), { error: null }) }) }) }));
vi.mock("../ai/usage", () => ({ homeOverBudget: async () => false, recordHomeUsage: async () => {} }));
vi.mock("../ai/orca-read", () => ({ writeRead: writeMock }));
vi.mock("./load-page", () => ({ loadHome: vi.fn() }));
vi.mock("./load-manager", () => ({ loadManagerHome: vi.fn() }));

import { makeRead } from "./orca-read";

const FACTS = [
  { id: "need:a", text: "Manish: 120 leads untouched, 1 lead untouched", href: "/home", linkLabel: "Open →" },
  // Not a row on Home, so a point citing it adds something the row does not show (F4a).
  { id: "impact:r", text: "Replies: 4, 9 the week before", href: "/home#impact", linkLabel: "See why →" },
];
const point = (claim: string) => ({ claim, reason: "The row shows 120 and 1.", factIds: ["need:a", "impact:r"] });
const P = { auth: { userId: "u1", tenantId: "t1" } as never, scope: "business" as const, facts: FACTS, tz: "UTC", now: new Date("2026-11-10T01:00:00Z"), refreshes: 0, opened: true };

describe("Q11: makeRead retries once on a wrong count", () => {
  beforeEach(() => { vi.clearAllMocks(); upserts.length = 0; });

  it("'1 leads' is retried once with the exact fix; the corrected read is stored", async () => {
    writeMock
      .mockResolvedValueOnce({ points: [point("Manish is leaving 120 and 1 leads untouched")], usage: {} })
      .mockResolvedValueOnce({ points: [point("Manish is leaving 120 leads and 1 lead untouched")], usage: {} });
    const r = await makeRead(P);
    expect(writeMock).toHaveBeenCalledTimes(2);
    expect(writeMock.mock.calls[1][3].join(" ")).toContain("'1 leads'");
    expect(r.kind === "made" && r.read.points[0].claim).toBe("Manish is leaving 120 leads and 1 lead untouched");
  });
  it("a read that is right the first time is one call", async () => {
    writeMock.mockResolvedValueOnce({ points: [point("Manish is leaving 120 leads and 1 lead untouched")], usage: {} });
    await makeRead(P);
    expect(writeMock).toHaveBeenCalledTimes(1);
  });
  it("still wrong on the retry: the point is dropped, never repaired", async () => {
    writeMock.mockResolvedValue({ points: [point("Manish is leaving 120 and 1 leads untouched")], usage: {} });
    const r = await makeRead(P);
    expect(writeMock).toHaveBeenCalledTimes(2);
    expect(r.kind === "made" && r.read.points).toEqual([]);
  });
});
