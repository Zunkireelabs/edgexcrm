import { describe, expect, it } from "vitest";
import { failureReport, planCallLogSave, runPlan, type PlannedRequest } from "./call-log";

const base = { leadId: "L1", outcome: "talked" as const, callbackAt: null, nextListId: null, note: "" };

describe("planCallLogSave", () => {
  it("call → note → lead patch, in that order (the trigger would wipe a call-back written earlier)", () => {
    const plan = planCallLogSave({ ...base, note: "dad decides", callbackAt: "2026-11-11T05:15:00.000Z", nextListId: "list-2" });
    expect(plan.map((p) => p.step)).toEqual(["activity", "note", "lead"]);
    expect(plan[2]).toMatchObject({ method: "PATCH", url: "/api/v1/leads/L1", body: { callback_due_at: "2026-11-11T05:15:00.000Z", list_id: "list-2" } });
  });
  it("the call-back patch is always LAST, even with no note", () => {
    const plan = planCallLogSave({ ...base, outcome: "no_answer", callbackAt: "2026-11-11T05:15:00.000Z" });
    expect(plan.map((p) => p.step)).toEqual(["activity", "lead"]);
    expect(plan[0].body).toMatchObject({ activity_type: "call", call_outcome: "no_answer" });
  });
  it("only the activity when nothing else was chosen", () => {
    expect(planCallLogSave(base).map((p) => p.step)).toEqual(["activity"]);
  });
  it("'not interested' is a connected call, labelled in the subject", () => {
    const [a] = planCallLogSave({ ...base, outcome: "not_interested" });
    expect(a.body).toMatchObject({ call_outcome: "connected", subject: "Call: not interested" });
  });
  it("ticked AI fields go in ONE note-save request, still AFTER the activity and the note", () => {
    const plan = planCallLogSave({ ...base, note: "father pays", callbackAt: "2026-11-11T05:15:00.000Z", nextListId: "list-2", ai: { draftId: "d1", fields: [{ field: "sponsor_name", to: "Father" }] } });
    expect(plan.map((p) => p.step)).toEqual(["activity", "note", "lead"]);
    expect(plan[2]).toMatchObject({ method: "POST", url: "/api/v1/home/note-save", body: { leadId: "L1", draftId: "d1", fields: [{ field: "sponsor_name", to: "Father" }], callbackAt: "2026-11-11T05:15:00.000Z", nextListId: "list-2" } });
  });
  it("AI on but nothing ticked is today's plain PATCH", () => {
    const plan = planCallLogSave({ ...base, callbackAt: "2026-11-11T05:15:00.000Z", ai: { draftId: "d1", fields: [] } });
    expect(plan[1]).toMatchObject({ method: "PATCH", url: "/api/v1/leads/L1" });
  });
  it("a blank note is not sent", () => {
    expect(planCallLogSave({ ...base, note: "   " }).map((p) => p.step)).toEqual(["activity"]);
  });
});

describe("runPlan", () => {
  it("sends in order and stops at the first failure", async () => {
    const seen: string[] = [];
    const plan = planCallLogSave({ ...base, note: "x", callbackAt: "2026-11-11T05:15:00.000Z" });
    const r = await runPlan(plan, async (req: PlannedRequest) => {
      seen.push(req.step);
      return req.step === "note" ? { ok: false, message: "nope" } : { ok: true };
    });
    expect(seen).toEqual(["activity", "note"]);
    expect(r).toEqual({ ok: false, failed: "note", message: "nope", done: ["activity"] });
  });
  it("completes when every step succeeds", async () => {
    expect(await runPlan(planCallLogSave(base), async () => ({ ok: true }))).toEqual({ ok: true, data: {} });
  });
});

describe("F8: Book an office visit creates a task", () => {
  it("a my-tasks POST for the counsellor, with the lead and the due date, AFTER the lead step", () => {
    const plan = planCallLogSave({ ...base, callbackAt: "2026-11-11T05:15:00.000Z", officeVisit: { leadName: "Sujan Rai", dueDate: "2026-11-11" } });
    expect(plan.map((p) => p.step)).toEqual(["activity", "lead", "task"]);
    expect(plan[2]).toMatchObject({ method: "POST", url: "/api/v1/my-tasks", body: { title: "Office visit: Sujan Rai", due_date: "2026-11-11", lead_id: "L1" } });
  });
  it("no task unless asked", () => {
    expect(planCallLogSave(base).map((p) => p.step)).toEqual(["activity"]);
  });
});

describe("runPlan hands back each step's response (F1/F9 read the note-save answer)", () => {
  it("collects data per step", async () => {
    const plan = planCallLogSave({ ...base, ai: { draftId: "d1", fields: [{ field: "budget", to: "x" }] } });
    const r = await runPlan(plan, async (req) => ({ ok: true, data: req.step === "lead" ? { stageBlocked: "why" } : undefined }));
    expect(r).toEqual({ ok: true, data: { lead: { stageBlocked: "why" } } });
  });
});

describe("F2: a failure after the call was saved is a toast, never inline text in a log that closes", () => {
  it("the call saved, the next step failed: toast, log closes", () => {
    const f = failureReport({ ok: false, failed: "lead", message: "Add the student's highest qualification", done: ["activity", "note"] });
    expect(f).toEqual({ toast: "Saved the call, but the next step failed: Add the student's highest qualification", inline: null, close: true });
  });
  it("the office-visit task failing says so", () => {
    expect(failureReport({ ok: false, failed: "task", message: "boom", done: ["activity"] }).toast).toContain("office-visit task");
  });
  it("nothing saved yet: inline error, the log stays open to retry", () => {
    expect(failureReport({ ok: false, failed: "activity", message: "Network error", done: [] })).toEqual({ toast: null, inline: "Network error", close: false });
  });
});
