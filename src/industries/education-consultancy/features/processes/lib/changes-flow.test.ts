import { describe, it, expect } from "vitest";
import { approveVersion, type ApproveStore, type TakenChange } from "./approve";
import { buildBaselineSpec } from "./baseline";
import { editChange, rejectDraft, suggestChange, type ChangeRecord, type EditStore, type RejectStore, type SuggestStore } from "./changes-flow";
import { ADMIZZ_SETUP } from "./fixtures";
import { canApproveProcess } from "../server/context";
import type { ProcessSpec } from "./spec";

const KEY = "new_lead_first_call" as const;
const NOW = new Date("2026-11-10T00:00:00Z");
const POS = new Set(["counselor", "lead-executive", "branch-manager"]);

interface V { id: string; version: number; status: string; spec: ProcessSpec; summary?: string; rejected?: { reason: string; by: string } }

/** One in-memory world serving all four stores, with the same semantics the SQL has (one draft per process, conditional updates). */
function world(opts: { withLive?: boolean; owner?: string | null } = {}) {
  const live = opts.withLive ?? true;
  const owner = opts.owner === undefined ? "owner-1" : opts.owner;
  const versions: V[] = [{ id: "v1", version: 1, status: live ? "live" : "draft", spec: buildBaselineSpec(KEY, ADMIZZ_SETUP) }];
  const changes: ChangeRecord[] = [];
  let seq = 0;
  const proc = { id: "p1", owner_user_id: owner, live_version_id: live ? "v1" : (null as string | null) };
  const draftOf = () => versions.find((v) => v.status === "draft");
  const log: string[] = [];

  const suggest: SuggestStore = {
    async getProcess() { return { ...proc }; },
    async getSpec(id) { return versions.find((v) => v.id === id)?.spec ?? null; },
    async getOpenDraft() { const d = draftOf(); return d ? { id: d.id, version: d.version, status: d.status } : null; },
    async maxVersion() { return Math.max(...versions.map((v) => v.version)); },
    async createDraft(row) {
      if (draftOf()) return null;
      const v: V = { id: `v${versions.length + 1}`, version: row.version, status: "draft", spec: row.spec as ProcessSpec };
      versions.push(v);
      return { id: v.id, version: v.version, status: "draft" };
    },
    async insertChange(row) {
      const c: ChangeRecord = { ...row, id: `c${++seq}`, status: "open", taken: true, edited_by: null, edited_at: null, created_at: `2026-11-0${seq}T00:00:00Z` };
      changes.push(c);
      return c;
    },
    async positionSlugs() { return POS; },
  };
  const edit: EditStore = {
    async getChange(id) {
      const c = changes.find((x) => x.id === id);
      if (!c) return null;
      return { change: c, versionStatus: versions.find((v) => v.id === c.version_id)!.status, processKey: KEY, ownerUserId: proc.owner_user_id, liveVersionId: proc.live_version_id };
    },
    getSpec: suggest.getSpec,
    positionSlugs: suggest.positionSlugs,
    async updateChange(id, patch) { const c = changes.find((x) => x.id === id); if (!c) return null; Object.assign(c, patch); return c; },
  };
  const reject: RejectStore = {
    async getVersion(_k, id) { const v = versions.find((x) => x.id === id); return v ? { id: v.id, process_id: "p1", status: v.status, owner_user_id: proc.owner_user_id } : null; },
    async setRejected(id, by) { const v = versions.find((x) => x.id === id); if (!v || v.status !== "draft") return false; v.status = "rejected"; v.rejected = { reason: by.reason, by: by.userId }; return true; },
  };
  const approve: ApproveStore = {
    async getVersion(_k, id) { const v = versions.find((x) => x.id === id); return v ? { id: v.id, process_id: "p1", status: v.status, owner_user_id: proc.owner_user_id } : null; },
    async getLiveVersionId() { return versions.find((v) => v.status === "live")?.id ?? null; },
    async setStatus(id, from, to) { const v = versions.find((x) => x.id === id); if (!v || v.status !== from) return false; v.status = to; log.push(`${id}:${from}->${to}`); return true; },
    async setProcessLive(_p, id) { proc.live_version_id = id; },
    async listChanges(id): Promise<TakenChange[]> { return changes.filter((c) => c.version_id === id); },
    getSpec: suggest.getSpec,
    positionSlugs: suggest.positionSlugs,
    async setDraftSpec(id, spec, summary) { const v = versions.find((x) => x.id === id); if (!v || v.status !== "draft") return false; v.spec = spec as ProcessSpec; v.summary = summary; return true; },
    async markChanges(taken, notTaken) { for (const c of changes) { if (taken.includes(c.id)) c.status = "taken"; if (notTaken.includes(c.id)) c.status = "not_taken"; } },
  };
  return { versions, changes, proc, suggest, edit, reject, approve, log };
}

const sug = (w: ReturnType<typeof world>, input: Record<string, unknown>, userId = "admin-1") => suggestChange(w.suggest, { processKey: KEY, userId, input: { why: "because", ...input } });
const TARGET = { part: "step:first_contact", field: "target", after: { value: 85 } };
const WORDING = { part: "trigger", field: "wording", after: "A lead is created by a form or staff." };

describe("suggestChange", () => {
  it("409-case: no live version -> no_baseline", async () => {
    const w = world({ withLive: false });
    expect((await sug(w, TARGET)).kind).toBe("no_baseline");
    expect(w.changes).toHaveLength(0);
  });
  it("two suggestions -> ONE draft with two changes", async () => {
    const w = world();
    const a = await sug(w, TARGET, "admin-1");
    const b = await sug(w, WORDING, "admin-2");
    expect(a.kind === "ok" && a.createdDraft).toBe(true);
    expect(b.kind === "ok" && b.createdDraft).toBe(false);
    expect(w.versions.filter((v) => v.status === "draft")).toHaveLength(1);
    expect(w.changes).toHaveLength(2);
    expect(new Set(w.changes.map((c) => c.version_id)).size).toBe(1);
    expect(w.versions.find((v) => v.status === "draft")!.version).toBe(2);
  });
  it("before = the live value, author recorded, evidence kept", async () => {
    const w = world();
    const out = await sug(w, { ...TARGET, evidence: [{ metric: "first_contact_1h_pct", label: "Contacted within 1 hour", value: 17, stepKey: "first_contact" }] }, "admin-9");
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.change.before).toEqual({ value: 80, metric: "first_contact_1h_pct" });
    expect(out.change).toMatchObject({ author_kind: "person", author_user_id: "admin-9", after: { value: 85 } });
    expect(out.change.evidence).toHaveLength(1);
  });
  it("the draft starts as a copy of the live spec", async () => {
    const w = world();
    await sug(w, TARGET);
    expect(w.versions.find((v) => v.status === "draft")!.spec).toEqual(w.versions[0].spec);
  });
  it("a lost race on the unique index re-reads the winner's draft", async () => {
    const w = world();
    const real = w.suggest.getOpenDraft;
    let first = true;
    w.suggest.getOpenDraft = async (_p) => { if (first) { first = false; return null; } return real(_p); };
    w.versions.push({ id: "vX", version: 2, status: "draft", spec: w.versions[0].spec });
    const out = await sug(w, TARGET);
    expect(out.kind === "ok" && out.draft.id).toBe("vX");
    expect(out.kind === "ok" && out.createdDraft).toBe(false);
  });
  it.each([
    [{ ...TARGET, after: { value: 500 } }, /between 0 and 100/],
    [{ ...TARGET, after: { value: 80, metric: "arrived" } }, /not a target option/],
    [{ part: "step:call_back", field: "who", after: ["ghost"] }, /Unknown position/],
    [{ part: "done", field: "wording", after: "  " }, /can't be empty/],
    [{ part: "step:zzz", field: "wording", after: "x" }, /Unknown step/],
    [{ part: "nonsense", field: "wording", after: "x" }, /Unknown part/],
    [{ part: "done", field: "wording", after: "x", why: " " }, /Say why/],
  ])("invalid %# is refused and writes nothing", async (input, msg) => {
    const w = world();
    const out = await sug(w, input as Record<string, unknown>);
    expect(out.kind === "invalid" && out.error).toMatch(msg);
    expect(w.changes).toHaveLength(0);
    expect(w.versions).toHaveLength(1);
  });
});

describe("editChange", () => {
  const owner = { userId: "owner-1", canApprove: (o: string | null) => canApproveProcess({ userId: "owner-1", role: "owner" }, o), now: NOW };
  it("edits the proposed value, stamps edited_by/at, leaves the spec alone", async () => {
    const w = world();
    await sug(w, TARGET);
    const specBefore = JSON.stringify(w.versions.find((v) => v.status === "draft")!.spec);
    const out = await editChange(w.edit, { processKey: KEY, changeId: "c1", patch: { after: { value: 90 } }, ...owner });
    expect(out.kind === "ok" && out.edited).toBe(true);
    expect(w.changes[0]).toMatchObject({ after: { value: 90 }, edited_by: "owner-1", edited_at: NOW.toISOString() });
    expect(JSON.stringify(w.versions.find((v) => v.status === "draft")!.spec)).toBe(specBefore);
  });
  it("ticking does not stamp an edit", async () => {
    const w = world();
    await sug(w, TARGET);
    const out = await editChange(w.edit, { processKey: KEY, changeId: "c1", patch: { taken: false }, ...owner });
    expect(out.kind === "ok" && out.toggled && !out.edited).toBe(true);
    expect(w.changes[0]).toMatchObject({ taken: false, edited_by: null });
  });
  it("same value = no edit; empty patch = invalid; bad value = invalid", async () => {
    const w = world();
    await sug(w, TARGET);
    const same = await editChange(w.edit, { processKey: KEY, changeId: "c1", patch: { after: { value: 85 } }, ...owner });
    expect(same.kind === "ok" && same.edited).toBe(false);
    expect((await editChange(w.edit, { processKey: KEY, changeId: "c1", patch: {}, ...owner })).kind).toBe("invalid");
    expect((await editChange(w.edit, { processKey: KEY, changeId: "c1", patch: { after: { value: 400 } }, ...owner })).kind).toBe("invalid");
    expect(w.changes[0].after).toEqual({ value: 85 });
  });
  it("only while the draft is a draft; unknown id; wrong process", async () => {
    const w = world();
    await sug(w, TARGET);
    w.versions.find((v) => v.status === "draft")!.status = "rejected";
    expect(await editChange(w.edit, { processKey: KEY, changeId: "c1", patch: { taken: false }, ...owner })).toEqual({ kind: "not_a_draft", status: "rejected" });
    expect((await editChange(w.edit, { processKey: KEY, changeId: "nope", patch: { taken: false }, ...owner })).kind).toBe("not_found");
    expect((await editChange(w.edit, { processKey: "visa_to_enrolled", changeId: "c1", patch: { taken: false }, ...owner })).kind).toBe("not_found");
  });
});

describe("permission matrix (suggest = owner/admin gate; approve/reject/edit/tick = process owner or tenant owner)", () => {
  const can = (role: string, userId: string, owner: string | null) => canApproveProcess({ userId, role: role as never }, owner);
  it("tenant owner: yes; admin: no; the process owner who is an admin: yes; admin when nobody owns it: no", () => {
    expect(can("owner", "u1", "someone-else")).toBe(true);
    expect(can("admin", "u2", "someone-else")).toBe(false);
    expect(can("admin", "proc-owner", "proc-owner")).toBe(true);
    expect(can("admin", "u2", null)).toBe(false);
  });
  it("an admin who is not the owner can suggest but is forbidden to edit, reject and approve", async () => {
    const w = world();
    expect((await sug(w, TARGET, "admin-1")).kind).toBe("ok");
    const asAdmin = (o: string | null) => canApproveProcess({ userId: "admin-1", role: "admin" }, o);
    expect((await editChange(w.edit, { processKey: KEY, changeId: "c1", userId: "admin-1", canApprove: asAdmin, patch: { taken: false }, now: NOW })).kind).toBe("forbidden");
    expect((await rejectDraft(w.reject, { processKey: KEY, versionId: "v2", userId: "admin-1", canApprove: asAdmin, reason: "no", now: NOW })).kind).toBe("forbidden");
    expect((await approveVersion(w.approve, { processKey: KEY, versionId: "v2", userId: "admin-1", canApprove: asAdmin, now: NOW })).kind).toBe("forbidden");
    expect(w.changes[0].taken).toBe(true);
    expect(w.versions[1].status).toBe("draft");
  });
  it("the process owner (an admin) can do all three", async () => {
    const w = world({ owner: "admin-7" });
    await sug(w, TARGET);
    const asOwner = (o: string | null) => canApproveProcess({ userId: "admin-7", role: "admin" }, o);
    expect((await editChange(w.edit, { processKey: KEY, changeId: "c1", userId: "admin-7", canApprove: asOwner, patch: { taken: true }, now: NOW })).kind).toBe("ok");
    expect((await approveVersion(w.approve, { processKey: KEY, versionId: "v2", userId: "admin-7", canApprove: asOwner, now: NOW })).kind).toBe("ok");
  });
});

describe("approve a draft with changes", () => {
  const run = (w: ReturnType<typeof world>, id = "v2") => approveVersion(w.approve, { processKey: KEY, versionId: id, userId: "owner-1", canApprove: () => true, now: NOW });
  const step = (spec: ProcessSpec, k: string) => spec.steps.find((s) => s.key === k)!;

  it("mixed taken / not_taken: the spec has ONLY the taken ones, the rest are marked and kept", async () => {
    const w = world();
    await sug(w, TARGET); // c1
    await sug(w, WORDING); // c2
    await sug(w, { part: "step:call_back", field: "who", after: ["branch-manager"] }); // c3
    await editChange(w.edit, { processKey: KEY, changeId: "c2", userId: "owner-1", canApprove: () => true, patch: { taken: false }, now: NOW });
    expect(await run(w)).toEqual({ kind: "ok", retiredVersionId: "v1" });
    const v2 = w.versions[1];
    expect(v2.status).toBe("live");
    expect(step(v2.spec, "first_contact").target.value).toBe(85);
    expect(step(v2.spec, "call_back").who).toEqual(["branch-manager"]);
    expect(v2.spec.trigger.text).toBe(w.versions[0].spec.trigger.text); // untaken wording NOT applied
    expect(w.changes.map((c) => c.status)).toEqual(["taken", "not_taken", "taken"]);
    expect(w.changes).toHaveLength(3); // kept
    expect(w.versions[0].status).toBe("retired");
    expect(v2.summary).toBe("First contact: target; Call-back kept: who");
  });
  it("an edited value is what lands", async () => {
    const w = world();
    await sug(w, TARGET);
    await editChange(w.edit, { processKey: KEY, changeId: "c1", userId: "owner-1", canApprove: () => true, patch: { after: { value: 92 } }, now: NOW });
    await run(w);
    expect(step(w.versions[1].spec, "first_contact").target.value).toBe(92);
  });
  it("zero taken -> no_changes_taken, nothing written, draft still a draft", async () => {
    const w = world();
    await sug(w, TARGET);
    await editChange(w.edit, { processKey: KEY, changeId: "c1", userId: "owner-1", canApprove: () => true, patch: { taken: false }, now: NOW });
    expect(await run(w)).toEqual({ kind: "no_changes_taken" });
    expect(w.versions[1].status).toBe("draft");
    expect(w.versions[0].status).toBe("live");
    expect(w.changes[0].status).toBe("open");
  });
  it("applies onto the CURRENT live spec, not the draft's stale copy", async () => {
    const w = world();
    await sug(w, TARGET);
    // someone else changes live after the draft was opened (simulated by editing the live spec in place)
    step(w.versions[0].spec, "assign").text = "**Newer live wording** that the stale draft copy does not have.";
    await run(w);
    expect(step(w.versions[1].spec, "assign").text).toContain("Newer live wording");
    expect(step(w.versions[1].spec, "first_contact").target.value).toBe(85);
  });
  it("a taken change that no longer validates -> invalid, nothing promoted", async () => {
    const w = world();
    await sug(w, { part: "step:call_back", field: "who", after: ["branch-manager"] });
    w.suggest.positionSlugs = async () => POS;
    w.approve.positionSlugs = async () => new Set(["counselor"]); // the position was deleted meanwhile
    const out = await run(w);
    expect(out.kind).toBe("invalid");
    expect(w.versions[1].status).toBe("draft");
    expect(w.versions[0].status).toBe("live");
  });
  it("a baseline draft (no changes) approves exactly as in P1", async () => {
    const w = world({ withLive: false });
    expect(await run(w, "v1")).toEqual({ kind: "ok", retiredVersionId: null });
    expect(w.proc.live_version_id).toBe("v1");
  });
});

describe("rejectDraft", () => {
  const owner = { userId: "owner-1", canApprove: () => true, now: NOW };
  it("needs a one-line reason (1-300 chars)", async () => {
    const w = world();
    await sug(w, TARGET);
    for (const reason of [undefined, null, "", "   ", 5, "x".repeat(301)]) {
      expect((await rejectDraft(w.reject, { processKey: KEY, versionId: "v2", reason, ...owner })).kind).toBe("reason_required");
    }
    expect(w.versions[1].status).toBe("draft");
    expect((await rejectDraft(w.reject, { processKey: KEY, versionId: "v2", reason: "x".repeat(300), ...owner })).kind).toBe("ok");
  });
  it("marks it rejected with the reason, keeps the changes, frees the process for a new draft", async () => {
    const w = world();
    await sug(w, TARGET);
    expect((await rejectDraft(w.reject, { processKey: KEY, versionId: "v2", reason: "  Not now  ", ...owner })).kind).toBe("ok");
    expect(w.versions[1]).toMatchObject({ status: "rejected", rejected: { reason: "Not now", by: "owner-1" } });
    expect(w.changes).toHaveLength(1);
    const again = await sug(w, WORDING);
    expect(again.kind === "ok" && again.createdDraft && again.draft.version).toBe(3);
  });
  it("only a draft; unknown version", async () => {
    const w = world();
    expect(await rejectDraft(w.reject, { processKey: KEY, versionId: "v1", reason: "x", ...owner })).toEqual({ kind: "not_a_draft", status: "live" });
    expect((await rejectDraft(w.reject, { processKey: KEY, versionId: "zzz", reason: "x", ...owner })).kind).toBe("not_found");
  });
});
