// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: nav.replace }), useSearchParams: () => new URLSearchParams(nav.search) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { DoNextItem } from "../lib/types";
import { ManagerHome } from "./manager-home";
import type { ManagerData } from "../server/load-manager";
import { DoNextRow, type DoNextRows } from "./do-next-row";

afterEach(cleanup);

const base: DoNextItem = {
  key: "missed", kind: "missed_callbacks", tier: "today" as DoNextItem["tier"], title: "52 missed call-backs", why: "Call them through", chip: { text: "52", tone: "warn" }, tone: "warn",
  primaryAction: { type: "sheet", label: "Call through them" }, sortKey: { group: 0, at: 0 }, evidenceHref: "/leads",
};
const rows = (setSheetKey = vi.fn()) => ({ busy: null, openLog: null, hidden: new Set(), setOpenLog: vi.fn(), snooze: vi.fn(), markDone: vi.fn(), sheetKey: null, setSheetKey, router: { refresh: vi.fn() } }) as unknown as DoNextRows;

describe("grouped Do-next rows: the title opens the same sheet as the button (click-through fix 5)", () => {
  it("a grouped row's title is a button that opens its sheet, not a link to plain /leads", () => {
    const setSheetKey = vi.fn();
    render(<DoNextRow item={base} nextStage={null} tz="UTC" rows={rows(setSheetKey)} />);
    expect(screen.queryByRole("link", { name: "52 missed call-backs" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "52 missed call-backs" }));
    expect(setSheetKey).toHaveBeenCalledWith("missed");
  });
  it("an ordinary row's title is still a link to its evidence", () => {
    const item: DoNextItem = { ...base, key: "q", title: "Sita Gurung", primaryAction: { type: "open", href: "/leads/1", label: "Open" }, evidenceHref: "/leads/1" };
    render(<DoNextRow item={item} nextStage={null} tz="UTC" rows={rows()} />);
    expect(screen.getByRole("link", { name: "Sita Gurung" }).getAttribute("href")).toBe("/leads/1");
  });
});

describe("manager Needs-you rows (click-through round 3, E)", () => {
  const data = (why: string) =>
    ({
      tz: "UTC", greeting: "Hi", lede: "x", dateShort: "x", needsALook: { rows: [], others: 0 }, canOpenPulse: true, impact: { status: "unset", since: null, rows: [] },
      canSetLaunch: false, own: { doNext: { items: [] }, nextStageByLead: {} }, leaveWaiting: 0, branchName: null, shadow: null, rules: null,
      needsYou: [{ key: "k", tone: "new", icon: "user-plus", title: "Assign 7 new leads", chip: { text: "Waiting 2 h", tone: "new" }, why, actions: [] }],
    }) as unknown as ManagerData;
  it("a 'Suggested:' line may wrap to two lines; other rows stay on one", () => {
    const a = render(<ManagerHome data={data("Suggested: Gautam +2, Diplov +2, Kamana +2, Nikhil +1 \u00B7 they have the most room")} />);
    expect(a.container.querySelector(".eh-wh.eh-wh-wrap")).not.toBeNull();
    a.unmount();
    const b = render(<ManagerHome data={data("Oldest arrived 28 Oct.")} />);
    expect(b.container.querySelector(".eh-wh-wrap")).toBeNull();
  });
  it("a person row flagged wrapWhy may wrap too (round 5, M)", () => {
    const d = data("No touch or move on them for 3+ days · 3 actions, usual 22");
    d.needsYou[0].wrapWhy = true;
    const { container } = render(<ManagerHome data={d} />);
    expect(container.querySelector(".eh-wh.eh-wh-wrap")).not.toBeNull();
  });
  it("the title and the chip are siblings in .eh-tl so the stylesheet can let the chip shrink first", () => {
    const { container } = render(<ManagerHome data={data("x")} />);
    expect(container.querySelector(".eh-tl > .eh-nm")?.textContent).toBe("Assign 7 new leads");
    expect(container.querySelector(".eh-tl > .eh-chip")?.textContent).toBe("Waiting 2 h");
  });
  it("a one-button row is marked as holding a text button (round 4, H)", () => {
    const d = data("x");
    d.needsYou[0].actions = [{ type: "clear_stale", label: "Clear them", count: 551 }];
    const { container } = render(<ManagerHome data={d} />);
    expect(container.querySelector(".eh-it > .eh-ac.eh-ac-text")).not.toBeNull();
  });
});

describe("phone: text buttons get their own line (round 4, H)", () => {
  it("a grouped Do-next row ('Call through them') is marked", () => {
    const { container } = render(<DoNextRow item={base} nextStage={null} tz="UTC" rows={rows()} />);
    expect(container.querySelector(".eh-ac.eh-ac-text")).not.toBeNull();
  });
  it("an icon-only row (Call) stays beside the text, as H7 draws", () => {
    const item: DoNextItem = { ...base, key: "c", primaryAction: { type: "call", leadId: "1", leadName: "Sita", phone: "98" } };
    const { container } = render(<DoNextRow item={item} nextStage={null} tz="UTC" rows={rows()} />);
    expect(container.querySelector(".eh-ac")).not.toBeNull();
    expect(container.querySelector(".eh-ac-text")).toBeNull();
  });
  it("the rule lives only under the phone breakpoint", () => {
    const css = readFileSync(resolve(__dirname, "home.css"), "utf8");
    expect(css).toMatch(/@media \(max-width: 767px\) \{ \.eh-it > \.eh-ac\.eh-ac-text \{ grid-column: 2 \/ -1; justify-content: flex-start; \} \}/);
    // The same rule also lives in a container query (Q5), so a wide screen with a narrow column drops the buttons under the text too.
    expect(css).toMatch(/@container \(max-width: 700px\) \{\s*\.eh-list-needs \.eh-it > \.eh-ac\.eh-ac-text \{ grid-column: 2 \/ -1;/);
    expect(css.match(/eh-ac-text/g)).toHaveLength(2);
    expect(css).not.toContain("eh-ac-multi");
  });
});
