import { describe, it, expect } from "vitest";
import { availableTabs, parseTab, tabHref, visibleTabCount, TAB_ORDER, type TabUnlocks } from "./tabs";

const ALL: TabUnlocks = { emails: true, consent: true, applications: true, classes: true, documents: true, checkins: true };
const NONE: TabUnlocks = { emails: false, consent: false, applications: false, classes: false, documents: false, checkins: false };

describe("availableTabs (unlock rules)", () => {
  it("always has Overview, Activity, Tasks, Notes first, in that order", () => {
    expect(availableTabs(NONE)).toEqual(["overview", "activity", "tasks", "notes"]);
    expect(availableTabs(ALL)).toEqual([...TAB_ORDER]);
  });

  it("a Pre-qualified lead (no applications, consent, classes) hides those tabs", () => {
    const tabs = availableTabs({ ...NONE, emails: true, documents: true, checkins: true });
    expect(tabs).toEqual(["overview", "activity", "tasks", "notes", "emails", "documents", "checkins"]);
    expect(tabs).not.toContain("consent");
    expect(tabs).not.toContain("applications");
    expect(tabs).not.toContain("classes");
  });

  it("each unlock flag controls exactly its own tab", () => {
    for (const key of Object.keys(NONE) as (keyof TabUnlocks)[]) {
      const only = availableTabs({ ...NONE, [key]: true });
      expect(only).toHaveLength(5);
    }
  });
});

describe("visibleTabCount (overflow)", () => {
  const widths = Array(10).fill(100) as number[]; // 10 tabs, 100px each, gap 4
  const MORE = 80;

  it("everything fits: no +N more", () => {
    expect(visibleTabCount(widths, 1100, MORE)).toBe(10);
  });

  it("at a narrow row only the first four fit and six go into +6 more", () => {
    const k = visibleTabCount(widths, 536, MORE);
    expect(k).toBe(4);
    const hidden = availableTabs(ALL).slice(k);
    expect(hidden).toHaveLength(6);
    expect(hidden[0]).toBe("emails");
  });

  it("reserves room for the +N more trigger (a tab that fits alone but not with the trigger drops out)", () => {
    // 5 tabs = 5*100 + 4*4 = 516 would fit in 520 with no overflow; with 10 tabs the trigger needs 84px more.
    expect(visibleTabCount(widths, 520, MORE)).toBe(4);
  });

  it("never collapses below one tab, and handles an empty set", () => {
    expect(visibleTabCount(widths, 10, MORE)).toBe(1);
    expect(visibleTabCount([], 500, MORE)).toBe(0);
  });
});

describe("?tab= deep link", () => {
  const avail = availableTabs({ ...NONE, emails: true });

  it("opens the named tab when it exists for this lead", () => {
    expect(parseTab("activity", avail)).toBe("activity");
    expect(parseTab("EMAILS", avail)).toBe("emails");
  });

  it("falls back to Overview for missing, unknown or locked tabs", () => {
    expect(parseTab(null, avail)).toBe("overview");
    expect(parseTab("nope", avail)).toBe("overview");
    expect(parseTab("consent", avail)).toBe("overview"); // locked for this lead
  });

  it("writes ?tab= out, keeps other params, and drops it for Overview", () => {
    expect(tabHref("http://localhost/leads/abc", "tasks")).toBe("/leads/abc?tab=tasks");
    expect(tabHref("http://localhost/leads/abc?x=1&tab=tasks#a", "notes")).toBe("/leads/abc?x=1&tab=notes#a");
    expect(tabHref("http://localhost/leads/abc?x=1&tab=tasks", "overview")).toBe("/leads/abc?x=1");
  });
});
