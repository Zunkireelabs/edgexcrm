import { describe, it, expect, vi, beforeEach } from "vitest";

// suppressEmail -> ends the sequences of the suppressed address (Outreach Phase 4, migration 262). Pure unit test with a
// fake db (the DB-backed suppression.test.ts is a different file): the hook runs after a successful suppress, with the
// caller's details; a failed suppress never reaches it; a failing hook never fails the suppression.

const stopMock = vi.fn();
vi.mock("@/industries/_shared/features/outreach/lib/stop-on-suppression", () => ({
  stopEnrollmentsForSuppressedEmail: (...a: unknown[]) => stopMock(...a),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { suppressEmail } from "./suppression";

let upsertError: { message: string } | null;
const upserts: Array<Record<string, unknown>> = [];
const db = {
  from: () => ({
    upsert: async (row: Record<string, unknown>) => {
      upserts.push(row);
      return { error: upsertError };
    },
  }),
} as never;

beforeEach(() => {
  upsertError = null;
  upserts.length = 0;
  stopMock.mockReset().mockResolvedValue({ leads: 1, ended: 1, queueCancelled: 0 });
});

describe("suppressEmail ends the sequences of that address", () => {
  it("calls the stop with the tenant, the address, the lead and the reason after suppressing", async () => {
    await suppressEmail(db, "t1", { email: "Bad@Example.com", reason: "hard_bounce", source: "webhook_bounce", leadId: "lead-1" });

    expect(upserts[0]).toMatchObject({ email: "bad@example.com", reason: "hard_bounce" });
    expect(stopMock).toHaveBeenCalledWith(db, { tenantId: "t1", email: "Bad@Example.com", leadId: "lead-1", reason: "hard_bounce" });
  });

  it("covers every reason (unsubscribe, complaint, manual …) and a missing lead id", async () => {
    for (const reason of ["unsubscribe", "complaint", "manual", "invalid"] as const) {
      stopMock.mockClear();
      await suppressEmail(db, "t1", { email: "x@y.com", reason, source: "test" });
      expect(stopMock).toHaveBeenCalledWith(db, expect.objectContaining({ leadId: null, reason }));
    }
  });

  it("a suppression that failed to save never ends anything (and still throws)", async () => {
    upsertError = { message: "db down" };
    await expect(suppressEmail(db, "t1", { email: "x@y.com", reason: "unsubscribe", source: "t" })).rejects.toThrow("db down");
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("a failing stop never fails the suppression", async () => {
    stopMock.mockRejectedValue(new Error("boom"));
    await expect(suppressEmail(db, "t1", { email: "x@y.com", reason: "unsubscribe", source: "t" })).resolves.toBeUndefined();
    expect(upserts).toHaveLength(1);
  });
});
