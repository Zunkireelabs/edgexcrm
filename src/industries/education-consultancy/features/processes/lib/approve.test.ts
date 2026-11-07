import { describe, it, expect } from "vitest";
import { approveVersion, REVIEW_EVERY_DAYS, type ApproveStore } from "./approve";
import { canApproveProcess } from "../server/context";
import { buildImprovements } from "./improvements";

function store(init: { versions: Array<{ id: string; status: string }>; owner?: string | null }) {
  const versions = init.versions.map((v) => ({ ...v, process_id: "p1" }));
  const log: string[] = [];
  let liveOn: string | null = null;
  let dueOn: string | null = null;
  const s: ApproveStore = {
    async getVersion(_k, id) { const v = versions.find((x) => x.id === id); return v ? { id: v.id, process_id: "p1", status: v.status, owner_user_id: init.owner ?? "owner-1" } : null; },
    async getLiveVersionId() { return versions.find((v) => v.status === "live")?.id ?? null; },
    async setStatus(id, from, to) { const v = versions.find((x) => x.id === id); if (!v || v.status !== from) return false; v.status = to; log.push(`${id}:${from}->${to}`); return true; },
    async setProcessLive(_p, id, due) { liveOn = id; dueOn = due; },
  };
  return { s, versions, log, live: () => liveOn, due: () => dueOn };
}
const run = (s: ApproveStore, can: boolean, id = "v1") => approveVersion(s, { processKey: "new_lead_first_call", versionId: id, userId: "u", canApprove: () => can, now: new Date("2026-11-07T00:00:00Z") });

describe("approveVersion", () => {
  it("draft -> live and points the process at it", async () => {
    const m = store({ versions: [{ id: "v1", status: "draft" }] });
    expect(await run(m.s, true)).toEqual({ kind: "ok", retiredVersionId: null });
    expect(m.versions[0].status).toBe("live");
    expect(m.live()).toBe("v1");
  });
  it("sets the next review 30 days after approval", async () => {
    const m = store({ versions: [{ id: "v1", status: "draft" }] });
    await run(m.s, true);
    expect(REVIEW_EVERY_DAYS).toBe(30);
    expect(m.due()).toBe("2026-12-07T00:00:00.000Z");
  });
  it("sets no review date when nothing was approved", async () => {
    const m = store({ versions: [{ id: "v1", status: "live" }] });
    await run(m.s, true);
    expect(m.due()).toBeNull();
  });
  it("retires the previous live version first", async () => {
    const m = store({ versions: [{ id: "v0", status: "live" }, { id: "v1", status: "draft" }] });
    expect(await run(m.s, true)).toEqual({ kind: "ok", retiredVersionId: "v0" });
    expect(m.log).toEqual(["v0:live->retired", "v1:draft->live"]);
  });
  it("refuses a non-owner, and writes nothing", async () => {
    const m = store({ versions: [{ id: "v1", status: "draft" }] });
    expect(await run(m.s, false)).toEqual({ kind: "forbidden" });
    expect(m.log).toEqual([]);
  });
  it("refuses a version that is not a draft, and an unknown one", async () => {
    const m = store({ versions: [{ id: "v1", status: "live" }] });
    expect(await run(m.s, true)).toMatchObject({ kind: "not_a_draft", status: "live" });
    expect(await run(m.s, true, "nope")).toEqual({ kind: "not_found" });
  });
});

describe("who can approve", () => {
  it("any tenant owner, or the process's own owner; an admin who isn't the owner can't", () => {
    expect(canApproveProcess({ userId: "a", role: "owner" }, "someone")).toBe(true);
    expect(canApproveProcess({ userId: "a", role: "admin" }, "a")).toBe(true);
    expect(canApproveProcess({ userId: "a", role: "admin" }, "b")).toBe(false);
    expect(canApproveProcess({ userId: "a", role: "admin" }, null)).toBe(false);
  });
});

describe("buildImprovements (real events only)", () => {
  it("is empty with no versions", () => expect(buildImprovements([])).toEqual([]));
  it("groups the baselines and lists approvals, newest first", () => {
    const rows = (["new_lead_first_call", "visa_to_enrolled"] as const).map((key, i) => ({
      key, version: 1, source: "system" as const, created_at: `2026-11-07T10:0${i}:00Z`, approved_at: i === 0 ? "2026-11-08T09:00:00Z" : null,
    }));
    const ev = buildImprovements(rows);
    expect(ev.map((e) => e.kind)).toEqual(["approved", "baseline"]);
    expect(ev[1].text).toBe("2 processes written from your data (v1 as-is baseline)");
    expect(ev[0].text).toContain("v1 approved");
  });
});
