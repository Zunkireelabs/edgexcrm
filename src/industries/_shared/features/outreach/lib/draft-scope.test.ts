import { describe, it, expect, vi } from "vitest";
import { buildDraftsQuery, cleanUuid, DRAFT_LIST_SELECT } from "./draft-scope";

// WHICH drafts a person may see / act on — shared by the Today list and the bulk actions. Records every filter applied.

vi.mock("@/lib/api/permissions", () => ({
  shouldRestrictToSelf: (p: { restrict?: boolean }) => !!p?.restrict,
}));

function recorder() {
  const calls: Array<[string, ...unknown[]]> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = new Proxy({}, { get: (_t, m: string) => (...args: unknown[]) => { calls.push([m, ...args]); return q; } });
  const db = { from: (t: string) => { calls.push(["from", t]); return q; } } as never;
  return { db, calls };
}
const has = (calls: Array<[string, ...unknown[]]>, ...call: unknown[]) => calls.some((c) => JSON.stringify(c) === JSON.stringify(call));
const auth = (over: Record<string, unknown> = {}) => ({ userId: "u1", role: "admin", permissions: {}, ...over }) as never;

describe("cleanUuid", () => {
  it("only a real uuid survives", () => {
    expect(cleanUuid("3168f9d7-23c7-48c1-a29b-3b9a94b3512f")).toBe("3168f9d7-23c7-48c1-a29b-3b9a94b3512f");
    expect(cleanUuid("not-a-uuid")).toBeNull();
    expect(cleanUuid("1' or '1'='1")).toBeNull();
    expect(cleanUuid(null)).toBeNull();
    expect(cleanUuid(undefined)).toBeNull();
  });
});

describe("buildDraftsQuery", () => {
  it("always: pending drafts, of an ACTIVE enrollment, of a lead that is not deleted", () => {
    const { db, calls } = recorder();
    buildDraftsQuery(db, auth(), {});
    expect(has(calls, "from", "sequence_step_drafts")).toBe(true);
    expect(has(calls, "select", DRAFT_LIST_SELECT, undefined)).toBe(true);
    expect(has(calls, "eq", "status", "pending")).toBe(true);
    expect(has(calls, "is", "leads.deleted_at", null)).toBe(true);
    expect(has(calls, "eq", "sequence_enrollments.status", "active")).toBe(true);
  });

  it("owner / admin see everyone's drafts — no assignee filter unless one was asked for", () => {
    const { db, calls } = recorder();
    buildDraftsQuery(db, auth({ role: "owner" }), {});
    expect(calls.some((c) => c[0] === "eq" && c[1] === "assigned_to")).toBe(false);

    const asked = recorder();
    buildDraftsQuery(asked.db, auth(), { assignedTo: "3168f9d7-23c7-48c1-a29b-3b9a94b3512f" });
    expect(has(asked.calls, "eq", "assigned_to", "3168f9d7-23c7-48c1-a29b-3b9a94b3512f")).toBe(true);
  });

  it("everyone else — counselors included — only ever sees their OWN drafts, even if they ask for another person's", () => {
    const { db, calls } = recorder();
    buildDraftsQuery(db, auth({ role: "staff" }), { assignedTo: "3168f9d7-23c7-48c1-a29b-3b9a94b3512f" });
    expect(has(calls, "eq", "assigned_to", "u1")).toBe(true);
    expect(has(calls, "eq", "assigned_to", "3168f9d7-23c7-48c1-a29b-3b9a94b3512f")).toBe(false);
  });

  it("an admin whose position restricts them to their own leads is restricted too", () => {
    const { db, calls } = recorder();
    buildDraftsQuery(db, auth({ permissions: { restrict: true } }), { assignedTo: "3168f9d7-23c7-48c1-a29b-3b9a94b3512f" });
    expect(has(calls, "eq", "assigned_to", "u1")).toBe(true);
  });

  it("due=today means due now or earlier; due=all adds no time filter", () => {
    const today = recorder();
    buildDraftsQuery(today.db, auth(), { due: "today" });
    const lte = today.calls.find((c) => c[0] === "lte");
    expect(lte?.[1]).toBe("due_at");
    expect(Math.abs(new Date(String(lte?.[2])).getTime() - Date.now())).toBeLessThan(5000);

    const all = recorder();
    buildDraftsQuery(all.db, auth(), { due: "all" });
    expect(all.calls.some((c) => c[0] === "lte")).toBe(false);
  });

  it("narrows to one lead when asked (the lead page's next-email line)", () => {
    const { db, calls } = recorder();
    buildDraftsQuery(db, auth(), { leadId: "3168f9d7-23c7-48c1-a29b-3b9a94b3512f" });
    expect(has(calls, "eq", "lead_id", "3168f9d7-23c7-48c1-a29b-3b9a94b3512f")).toBe(true);
  });

  it("passes the count options and a custom select through", () => {
    const { db, calls } = recorder();
    buildDraftsQuery(db, auth(), {}, "id, leads!inner(email), sequence_enrollments!inner(status)", { count: "exact", head: true });
    expect(has(calls, "select", "id, leads!inner(email), sequence_enrollments!inner(status)", { count: "exact", head: true })).toBe(true);
  });
});
