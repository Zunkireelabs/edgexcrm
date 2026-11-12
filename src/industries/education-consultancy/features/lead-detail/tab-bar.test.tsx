// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { availableTabs, TAB_LABEL, type TabId } from "./lib/tabs";
import { TabBar, type TabDef } from "./tab-bar";

// jsdom has no layout: give every measured tab 100px, the "+N more" sample 80px, and the row a width we control.
let rowWidth = 560;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() { return this.hasAttribute?.("data-measure-tab") ? 100 : this.hasAttribute?.("data-measure-more") ? 80 : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return this.tagName === "NAV" ? rowWidth : 0; } });
  vi.stubGlobal("ResizeObserver", class { cb: () => void; constructor(cb: () => void) { this.cb = cb; } observe() { this.cb(); } disconnect() {} unobserve() {} });
});
afterEach(cleanup);

const defs = (ids: TabId[], extra: Partial<Record<TabId, Partial<TabDef>>> = {}): TabDef[] =>
  ids.map((id) => ({ id, label: TAB_LABEL[id], icon: <i />, count: null, ...extra[id] }));
const ALL = availableTabs({ emails: true, consent: true, applications: true, classes: true, documents: true, checkins: true });

describe("TabBar", () => {
  it("narrow row: only Overview/Activity/Tasks/Notes stay, the rest sit in '+6 more'", () => {
    rowWidth = 560; // 536 inner → 4 tabs + the trigger
    render(<TabBar tabs={defs(ALL)} active="overview" onSelect={() => {}} />);
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Overview", "Activity", "Tasks", "Notes"]);
    expect(screen.getByRole("button", { name: "6 more tabs" }).textContent).toContain("+6 more");
  });

  it("wide row: everything fits, no +N more", () => {
    rowWidth = 1200;
    render(<TabBar tabs={defs(ALL)} active="overview" onSelect={() => {}} />);
    expect(within(screen.getByRole("tablist")).getAllByRole("tab")).toHaveLength(10);
    expect(screen.queryByRole("button", { name: /more tabs/ })).toBeNull();
  });

  it("a stage that unlocks fewer tabs shows fewer tabs", () => {
    rowWidth = 1200;
    const few = availableTabs({ emails: true, consent: false, applications: false, classes: false, documents: false, checkins: false });
    render(<TabBar tabs={defs(few)} active="overview" onSelect={() => {}} />);
    expect(within(screen.getByRole("tablist")).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Overview", "Activity", "Tasks", "Notes", "Emails"]);
  });

  it("is a real tablist: aria-selected on the active tab, roving tabindex, arrow keys move and activate", () => {
    rowWidth = 1200;
    const onSelect = vi.fn();
    render(<TabBar tabs={defs(["overview", "activity", "tasks", "notes"])} active="activity" onSelect={onSelect} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false"]);
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "0", "-1", "-1"]);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenLastCalledWith("tasks");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith("overview");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith("notes");
  });

  it("shows counts, and the amber 'N left' hint on Consent & fee", () => {
    rowWidth = 1200;
    render(<TabBar tabs={defs(["overview", "activity", "consent"], { activity: { count: 14 }, consent: { hint: "2 left" } })} active="overview" onSelect={() => {}} />);
    expect(screen.getByRole("tab", { name: /Activity/ }).textContent).toContain("14");
    const consent = screen.getByRole("tab", { name: /Consent & fee/ });
    expect(within(consent).getByText("2 left").className).toContain("text-[#b25e09]");
  });
});
