// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { DoNextItem } from "../lib/types";
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
