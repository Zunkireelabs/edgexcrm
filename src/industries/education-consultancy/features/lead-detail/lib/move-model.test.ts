import { describe, it, expect, vi } from "vitest";
import {
  buildMoveMenu, canQualify, confirmCopy, defaultAssignee, followUpDefaults, handOffToast, isStepBack, needsProspectGate, resolveHandOffTarget, revertNote, whenToIso,
} from "./move-model";
import type { LeadNavContext } from "./lead-nav";

const ctx: LeadNavContext = { viewLabel: "My leads", href: "/leads?view=mine", query: { view: "mine" }, page: 1, pageSize: 3, ids: ["a", "b", "c"], total: 3 };
const members = [
  { user_id: "u1", email: "farhan@x.test", name: "Farhan Ali" },
  { user_id: "u2", email: "binod@x.test", name: "Binod Rai" },
];

describe("Qualify minimum (UI-only rule; the server rule is EDGEX-158)", () => {
  it("is off with nothing, on with a country only, on with a course only", () => {
    expect(canQualify([], "")).toBe(false);
    expect(canQualify([], "   ")).toBe(false);
    expect(canQualify(["Australia"], "")).toBe(true);
    expect(canQualify([], "Nursing")).toBe(true);
  });
});

describe("assignee default (never empty)", () => {
  it("preselects the first person of the team", () => expect(defaultAssignee(members, "next", null)).toBe("u1"));
  it("a revert starts on the previous holder when they are in the list", () => expect(defaultAssignee(members, "back", "u2")).toBe("u2"));
  it("a revert whose previous holder is not listed falls back to the first person", () => expect(defaultAssignee(members, "back", "zzz")).toBe("u1"));
  it("is empty only when there is nobody to pick", () => expect(defaultAssignee([], "next", null)).toBe(""));
});

describe("confirm copy", () => {
  it("Send to Prospects: names the person on the button", () => {
    const c = confirmCopy({ direction: "next", targetName: "Prospects", leadName: "Sita Karki", isBackward: false, chainSend: true });
    expect(c.title).toBe("Send to Prospects?");
    expect(c.body).toBe("Sita Karki moves to Prospects and leaves your list.");
    expect(c.button("Farhan Ali")).toBe("Send to Farhan");
    expect(c.tone).toBe("blue");
  });
  it("Move to… uses the step-back wording only when going backward", () => {
    expect(confirmCopy({ direction: "move", targetName: "Qualified", leadName: "Aarav", isBackward: true, chainSend: false }).body).toBe("This is a step back. Aarav moves to Qualified.");
    expect(confirmCopy({ direction: "move", targetName: "Prospects", leadName: "Aarav", isBackward: false, chainSend: false }).body).toBe("Aarav moves to Prospects.");
  });
  it("Revert is amber", () => {
    const c = confirmCopy({ direction: "back", targetName: "Pre-qualified", leadName: "Sita", isBackward: true, chainSend: true });
    expect(c.title).toBe("Revert to Pre-qualified?");
    expect(c.tone).toBe("amber");
  });
});

describe("the %/GPA gate comes first, only moving forward into Prospects without a qualification", () => {
  it("shows for a forward move into Prospects with no %/GPA", () => expect(needsProspectGate({ target: { slug: "prospects" }, stepBack: false, hasQualification: false })).toBe(true));
  it("not with a qualification on file, not for a step back, not for other stages", () => {
    expect(needsProspectGate({ target: { slug: "prospects" }, stepBack: false, hasQualification: true })).toBe(false);
    expect(needsProspectGate({ target: { slug: "prospects" }, stepBack: true, hasQualification: false })).toBe(false);
    expect(needsProspectGate({ target: { slug: "qualified" }, stepBack: false, hasQualification: false })).toBe(false);
  });
  it("isStepBack: earlier funnel position only; archive/staging are never 'from'", () => {
    expect(isStepBack({ sort_order: 3, is_archive: false, is_staging: false }, { sort_order: 2 })).toBe(true);
    expect(isStepBack({ sort_order: 2, is_archive: false, is_staging: false }, { sort_order: 3 })).toBe(false);
    expect(isStepBack({ sort_order: 9, is_archive: true, is_staging: false }, { sort_order: 2 })).toBe(false);
  });
});

describe("Move to… menu", () => {
  const chain = [
    { id: "pre", name: "Pre-qualified", slug: "pre-qualified", sort_order: 1 },
    { id: "q", name: "Qualified", slug: "qualified", sort_order: 2 },
    { id: "p", name: "Prospects", slug: "prospects", sort_order: 3 },
    { id: "app", name: "Applications", slug: "applications", sort_order: 4 },
  ];
  const all = new Set(chain.map((c) => c.id));
  it("ticks the current stage (disabled) and disables Applications with 'n missing'", () => {
    const m = buildMoveMenu({ chain, accessibleIds: all, currentListId: "p", readiness: { ready: false, missing: ["Processing fee", "Consent signed"] } });
    expect(m.map((o) => o.label)).toEqual(["Pre-qualified", "Qualified", "Prospects", "Applications"]);
    expect(m.find((o) => o.value === "p")).toMatchObject({ disabled: true, secondary: "Current" });
    expect(m.find((o) => o.value === "app")).toMatchObject({ disabled: true, secondary: "2 missing", secondaryTone: "warn" });
    expect(m.find((o) => o.value === "q")?.disabled).toBeUndefined();
  });
  it("counts 'n missing' like the Highlights card: a 'Basic info (a, b)' line is two fields (one readiness source)", () => {
    const m = buildMoveMenu({ chain, accessibleIds: all, currentListId: "p", readiness: { ready: false, missing: ["Basic info (Passport Number, Date Of Birth)", "Consent signed"] } });
    expect(m.find((o) => o.value === "app")?.secondary).toBe("3 missing");
  });
  it("leaves Applications open when ready or when readiness is unknown (the server re-checks)", () => {
    expect(buildMoveMenu({ chain, accessibleIds: all, currentListId: "p", readiness: { ready: true, missing: [] } }).find((o) => o.value === "app")?.disabled).toBeUndefined();
    expect(buildMoveMenu({ chain, accessibleIds: all, currentListId: "p", readiness: null }).find((o) => o.value === "app")?.disabled).toBeUndefined();
  });
  it("lists only stages the caller can reach", () => {
    expect(buildMoveMenu({ chain, accessibleIds: new Set(["q"]), currentListId: "p", readiness: null }).map((o) => o.value)).toEqual(["q", "p"]);
  });
});

describe("hand-off: which lead opens next", () => {
  it("opens the next lead of the view", async () => {
    expect(await resolveHandOffTarget(ctx, "a", "/leads")).toMatchObject({ nextId: "b", href: "/leads?view=mine" });
  });
  it("goes back to the view when there is no context", async () => {
    expect(await resolveHandOffTarget(null, "a", "/leads")).toEqual({ nextId: null, href: "/leads", ctx: null });
  });
  it("is strictly next-only: the last lead of the view goes back to the view, not to the previous row", async () => {
    expect(await resolveHandOffTarget({ ...ctx, ids: ["a", "b", "c"], total: 3 }, "c", "/leads")).toMatchObject({ nextId: null, href: "/leads?view=mine" });
  });
  it("goes back to the view when the lead is not in the stored context (stale)", async () => {
    expect(await resolveHandOffTarget(ctx, "zzz", "/leads")).toMatchObject({ nextId: null, href: "/leads?view=mine" });
  });
  it("fetches the neighbouring page when the next row lives there", async () => {
    const adj = vi.fn().mockResolvedValue({ id: "d", ctx: { ...ctx, page: 2, ids: ["d", "e"] } });
    const r = await resolveHandOffTarget({ ...ctx, total: 6 }, "c", "/leads", adj);
    expect(adj).toHaveBeenCalledWith(expect.anything(), "next");
    expect(r.nextId).toBe("d");
    expect(r.ctx?.page).toBe(2);
  });
  it("says what happened", () => expect(handOffToast("Sita Karki", "Farhan Ali", "Prospects")).toBe("Sita Karki sent to Farhan Ali · Prospects"));
});

describe("Revert 'Why'", () => {
  it("is a note only when something was written", () => {
    expect(revertNote("  Not reachable ")).toBe("Not reachable");
    expect(revertNote("   ")).toBeNull();
  });
});

describe("Log call When", () => {
  const now = new Date("2026-11-12T10:00:00");
  it("sends nothing for 'now' (the server stamps it)", () => {
    expect(whenToIso("", now)).toEqual({ iso: null, error: null });
    expect(whenToIso("2026-11-12T09:59:30", now)).toEqual({ iso: null, error: null });
  });
  it("sends an ISO time for a past call", () => {
    const r = whenToIso("2026-11-11T16:30", now);
    expect(r.error).toBeNull();
    expect(r.iso).toBe(new Date("2026-11-11T16:30").toISOString());
  });
  it("refuses the future and junk", () => {
    expect(whenToIso("2026-11-12T11:00", now).error).toMatch(/future/);
    expect(whenToIso("nope", now).error).toMatch(/valid/);
  });
});

describe("follow-up task prefill", () => {
  it("is 'Follow up: <first name>' due tomorrow (tasks.due_date is a DATE, so no 10:00)", () => {
    expect(followUpDefaults("Aarav Shrestha", new Date("2026-11-12T20:00:00"))).toEqual({ title: "Follow up: Aarav", due: "2026-11-13" });
  });
});
