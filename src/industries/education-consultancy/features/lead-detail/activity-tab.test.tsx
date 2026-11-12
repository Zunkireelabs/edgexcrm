// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { ActivityTab } from "./activity-tab";
import { mergeFeed } from "./lib/activity-merge";

afterEach(cleanup);

const nameOf = (id: string | null | undefined, fb?: string | null) => (id === "u1" ? "Farhan Ali" : fb ?? null);
const feed = mergeFeed({
  notes: [
    { id: "n1", user_id: "u1", user_email: "f@x", content: "Prefers Sydney or Melbourne", created_at: new Date(2026, 10, 9, 10).toISOString() },
    { id: "n2", user_id: "u1", user_email: "f@x", content: "[CHECK-IN] Visited on 6 Nov at 14:55 — Walk-in visit", created_at: new Date(2026, 10, 6, 14, 55).toISOString() },
  ],
  logged: [{ id: "l1", user_id: "u1", activity_type: "call", subject: null, description: "Waiting on parents", call_outcome: null, duration_minutes: null, email_subject: null, email_body: null, created_at: new Date(2026, 10, 10, 9).toISOString() }],
  emails: [], audits: [], leadCreatedAt: new Date(2026, 9, 19).toISOString(), sourceLabel: "Website form", nameOf,
});

describe("ActivityTab", () => {
  it("chips with counts: All · Calls · Notes · Emails · Stage & owner · Check-ins", () => {
    render(<ActivityTab feed={feed} currentUserId="me" onLog={() => {}} onAddNote={() => {}} />);
    const group = screen.getByRole("group", { name: "Filter activity" });
    const labels = within(group).getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["All4", "Calls1", "Notes1", "Emails0", "Stage & owner0", "Check-ins1"]);
  });

  it("shows the creation event and quoted bodies; a chip narrows the list", () => {
    render(<ActivityTab feed={feed} currentUserId="me" onLog={() => {}} onAddNote={() => {}} />);
    expect(screen.getByText("created the lead")).toBeTruthy();
    expect(screen.getByText("Prefers Sydney or Melbourne").className).toContain("bg-[#f6f7f9]");
    fireEvent.click(within(screen.getByRole("group", { name: "Filter activity" })).getByRole("button", { name: /^Calls/ }));
    expect(screen.queryByText("Prefers Sydney or Melbourne")).toBeNull();
    expect(screen.getByText("Waiting on parents")).toBeTruthy();
    expect(screen.queryByText("created the lead")).toBeNull();
  });

  it("an empty chip shows the empty state with its one button, which logs a call", () => {
    const onLog = vi.fn();
    render(<ActivityTab feed={feed} currentUserId="me" onLog={onLog} onAddNote={() => {}} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Filter activity" })).getByRole("button", { name: /^Emails/ }));
    expect(screen.getByText("No emails yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Log an email" }));
    expect(onLog).toHaveBeenCalledWith("email");
  });

  it("loading: skeleton, no rows", () => {
    const { container } = render(<ActivityTab feed={null} currentUserId="me" onLog={() => {}} onAddNote={() => {}} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("connector lines: between items of the SAME day only, none after a group's last item, none across days", () => {
    const { container } = render(<ActivityTab feed={feed} currentUserId="me" onLog={() => {}} onAddNote={() => {}} />);
    // 4 items in 3 day groups (Nov 10 call; Nov 9 note; Nov 6 check-in; Oct 19 created) -> every group has one item -> no line at all.
    expect(container.querySelectorAll("[data-connector]")).toHaveLength(0);

    const two = mergeFeed({
      notes: [
        { id: "n1", user_id: "u1", user_email: "", content: "first", created_at: new Date(2026, 10, 9, 15).toISOString() },
        { id: "n2", user_id: "u1", user_email: "", content: "second", created_at: new Date(2026, 10, 9, 10).toISOString() },
        { id: "n3", user_id: "u1", user_email: "", content: "other day", created_at: new Date(2026, 10, 8, 10).toISOString() },
      ],
      logged: [], emails: [], audits: [], leadCreatedAt: new Date(2026, 9, 19).toISOString(), sourceLabel: null, nameOf,
    });
    cleanup();
    const r = render(<ActivityTab feed={two} currentUserId="me" onLog={() => {}} onAddNote={() => {}} />);
    // Nov 9 has 2 items -> exactly ONE line (after the first, not after the last); Nov 8 and Oct 19 have 1 item each.
    expect(r.container.querySelectorAll("[data-connector]")).toHaveLength(1);
    const first = screen.getByText("first").closest(".flex.gap-2\\.5") as HTMLElement;
    expect(first.querySelector("[data-connector]")).not.toBeNull();
    const second = screen.getByText("second").closest(".flex.gap-2\\.5") as HTMLElement;
    expect(second.querySelector("[data-connector]")).toBeNull();
  });
});
