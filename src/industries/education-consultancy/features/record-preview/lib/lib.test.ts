import { describe, it, expect } from "vitest";
import { flattenReadiness, readyCard, missingSub } from "./readiness";
import { pickIntake, formatIntake, pickTestScore, studyPlanCard } from "./study-plan";
import { dueLabel, pickNextTask, daysInStage, lastTouchCard, activityTime } from "./labels";
import { navState } from "./nav";

const NOW = new Date(2026, 10, 11, 12, 0, 0); // 11 Nov 2026 local

describe("flattenReadiness", () => {
  it("maps the gate labels to card items", () => {
    expect(flattenReadiness(["Processing fee", "Basic info (Passport Number, Date Of Birth)", "Consent signed"])).toEqual([
      "Pre-app fee", "Passport number", "Date of birth", "Signed consent",
    ]);
  });
  it("keeps unknown labels", () => expect(flattenReadiness(["Something else"])).toEqual(["Something else"]));
});

describe("readyCard", () => {
  it("not ready: count + as many items as fit the budget", () => {
    expect(readyCard({ ready: false, items: ["Pre-app fee", "Phone", "Degree level", "Field of study", "Passport"], consentSignedAt: null, hasActiveConsentTemplate: true, feeStatus: null }))
      .toEqual({ tone: "warn", value: "5 missing", sub: "Pre-app fee · Phone · +3 more" });
    expect(readyCard({ ready: false, items: ["Passport number", "Signed consent"], consentSignedAt: null, hasActiveConsentTemplate: true, feeStatus: null }).sub)
      .toBe("Passport number · +1 more");
  });
  it("ready: consent + fee, consent dropped without a template", () => {
    expect(readyCard({ ready: true, items: [], consentSignedAt: "2026-11-03T10:00:00", hasActiveConsentTemplate: true, feeStatus: "paid" }).sub)
      .toBe("Consent signed 3 Nov · Pre-app fee paid");
    expect(readyCard({ ready: true, items: [], consentSignedAt: null, hasActiveConsentTemplate: false, feeStatus: "waiver" }).sub).toBe("Pre-app fee waived");
  });
});

describe("intake + study plan", () => {
  it("intake source order", () => {
    expect(pickIntake({ intakeTerm: "2027-02", preferredIntake: "x", applicationIntakes: ["2026-09"] })).toBe("2027-02");
    expect(pickIntake({ intakeTerm: null, preferredIntake: "manual_entry", applicationIntakes: ["2026-09"] })).toBe("Manual Entry");
    expect(pickIntake({ applicationIntakes: ["2027-02", "2026-09", null] })).toBe("2026-09");
    expect(pickIntake({})).toBeNull();
  });
  it("formats intake", () => {
    expect(formatIntake("2027-02")).toBe("Feb 2027");
    expect(formatIntake("September 2026")).toBe("Sep 2026");
    expect(formatIntake("Spring")).toBe("Spring");
  });
  it("picks the first recorded test", () => {
    expect(pickTestScore({ ielts: "6.5", pte: "62" })).toBe("IELTS 6.5");
    expect(pickTestScore({ pte: "62", toefl: "95" })).toBe("PTE 62");
    expect(pickTestScore({ toefl: "95" })).toBe("TOEFL 95");
    expect(pickTestScore({})).toBeNull();
  });
  it("study plan strings", () => {
    expect(studyPlanCard({ destinations: ["Australia", "UK"], intake: "2027-02", degreeLevel: "Master's", fieldOfStudy: "IT", test: "IELTS 6.5" }))
      .toEqual({ value: "Australia, UK · Feb 2027", sub: "Master's · IT · IELTS 6.5", empty: false });
    expect(studyPlanCard({ destinations: ["Japan"], intake: null, degreeLevel: "Language course", test: null }))
      .toEqual({ value: "Japan · intake not set", sub: "Language course · no test yet", empty: false });
    expect(studyPlanCard({ destinations: [], intake: null, test: null })).toEqual({ value: "Destination and intake not set", sub: "Not set", empty: true });
    expect(studyPlanCard({ destinations: ["UK"], intake: null, fieldOfStudy: "Law", test: null }).sub).toBe("Law · no test yet");
  });
});

describe("due labels", () => {
  it("covers today/tomorrow/overdue/week/far", () => {
    expect(dueLabel("2026-11-11", NOW)).toEqual({ text: "Today", overdue: false });
    expect(dueLabel("2026-11-12", NOW)).toEqual({ text: "Tomorrow", overdue: false });
    expect(dueLabel("2026-11-09", NOW)).toEqual({ text: "Overdue 2d", overdue: true });
    expect(dueLabel("2026-11-14", NOW)).toEqual({ text: "Sat 14 Nov", overdue: false });
    expect(dueLabel("2026-11-25", NOW)).toEqual({ text: "25 Nov", overdue: false });
    expect(dueLabel(null, NOW)).toBeNull();
  });
  it("next task: due asc, no-due last", () => {
    expect(pickNextTask([{ due_date: null }, { due_date: "2026-11-20" }, { due_date: "2026-11-12" }])).toEqual({ due_date: "2026-11-12" });
    expect(pickNextTask([])).toBeNull();
  });
});

describe("days in stage + activity time", () => {
  it("days in stage", () => {
    expect(daysInStage("2026-11-11T08:00:00", NOW)).toBe("Today in stage");
    expect(daysInStage("2026-11-10T08:00:00", NOW)).toBe("1 day in stage");
    expect(daysInStage("2026-11-05T08:00:00", NOW)).toBe("6 days in stage");
  });
  it("activity time", () => {
    expect(activityTime("2026-11-11T11:59:50", NOW)).toBe("now");
    expect(activityTime("2026-11-11T11:30:00", NOW)).toBe("30m");
    expect(activityTime("2026-11-11T07:00:00", NOW)).toBe("5h");
    expect(activityTime("2026-11-08T12:00:00", NOW)).toBe("3d");
    expect(activityTime("2026-10-10T12:00:00", NOW)).toBe("10 Oct");
  });
});

describe("lastTouchCard (amber parity with followUpBadgeLabel)", () => {
  const base = { createdAt: "2026-10-23T00:00:00", kind: "call" as const, who: "You", staleDays: 7, now: NOW };
  it("stale → amber with follow-up note", () => {
    const c = lastTouchCard({ ...base, lastTouchedAt: "2026-10-30T12:00:00", onHold: false, followUpLabel: "12d since touch" });
    expect(c).toEqual({ value: "12 days ago", sub: "Call · You · over your 7-day follow-up", amber: true });
  });
  it("fresh → not amber", () => {
    const c = lastTouchCard({ ...base, lastTouchedAt: "2026-11-10T09:00:00", onHold: false, followUpLabel: null });
    expect(c).toEqual({ value: "Yesterday", sub: "Call · You", amber: false });
  });
  it("on hold never amber", () => {
    const c = lastTouchCard({ ...base, lastTouchedAt: "2026-10-01T12:00:00", onHold: true, followUpLabel: null });
    expect(c.amber).toBe(false);
    expect(c.sub).toBe("Call · You · On hold");
  });
  it("never touched", () => {
    expect(lastTouchCard({ ...base, lastTouchedAt: null, kind: null, who: null, onHold: false, followUpLabel: "Never touched" }))
      .toEqual({ value: "Never touched", sub: "Added 23 Oct", amber: true });
  });
});

describe("navState (J/K, cross-page)", () => {
  it("within page", () => {
    const s = navState({ rowIndex: 3, rowCount: 25, page: 1, pageSize: 25, total: 444 });
    expect(s.position).toBe(4);
    expect(s.next).toEqual({ kind: "row", index: 4 });
    expect(s.prev).toEqual({ kind: "row", index: 2 });
  });
  it("page edges cross pages; view edges disable", () => {
    expect(navState({ rowIndex: 24, rowCount: 25, page: 1, pageSize: 25, total: 444 }).next).toEqual({ kind: "page", page: 2, edge: "first" });
    expect(navState({ rowIndex: 0, rowCount: 25, page: 2, pageSize: 25, total: 444 }).prev).toEqual({ kind: "page", page: 1, edge: "last" });
    expect(navState({ rowIndex: 0, rowCount: 25, page: 1, pageSize: 25, total: 444 })).toMatchObject({ hasPrev: false, prev: null });
    const last = navState({ rowIndex: 18, rowCount: 19, page: 18, pageSize: 25, total: 444 });
    expect(last).toMatchObject({ position: 444, hasNext: false, next: null });
  });
});

describe("missingSub", () => {
  it("keeps as many items as fit in 30 chars including +N more", () => {
    expect(missingSub(["Pre-app fee", "Phone", "Degree level", "Field of study"])).toBe("Pre-app fee · Phone · +2 more");
    expect(missingSub(["Pre-app fee", "Field of study", "Degree level"])).toBe("Pre-app fee · +2 more");
  });
  it("shows everything when it all fits, and a single long item as-is", () => {
    expect(missingSub(["Phone", "Passport"])).toBe("Phone · Passport");
    expect(missingSub(["A very long single missing item name here"])).toBe("A very long single missing item name here");
  });
  it("always shows at least one item", () => {
    expect(missingSub(["A very long single missing item name here", "B"])).toBe("A very long single missing item name here · +1 more");
  });
});
