// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConversationList } from "./ConversationList";

afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const row = (over: Row): Row => ({
  id: "c1", provider: "chatwoot", channel_id: "ch1", contact_display_name: "Ram", last_message_preview: "Hi",
  last_message_at: "2026-11-24T10:00:00Z", unread_count: 0, status: "open", assignee_type: "unassigned", assigned_to_user_id: null,
  lead_id: null, ...over,
});

function show(rows: Row[], ownerNames?: Record<string, string>) {
  return render(
    <ConversationList
      conversations={rows} channels={[]} selectedId={null} onSelect={vi.fn()}
      filterStatus="open" filterAssignee="all" filterChannel="all"
      onFilterStatus={vi.fn()} onFilterAssignee={vi.fn()} onFilterChannel={vi.fn()}
      currentUserId="me" ownerNames={ownerNames}
    />,
  );
}
const chips = (c: HTMLElement) => Array.from(c.querySelectorAll("[data-claim-chip]")).map((e) => e.textContent);

describe("ConversationList chips on website chats", () => {
  it("shows 'Waiting to accept' for a chat nobody has", () => {
    expect(chips(show([row({})]).container)).toEqual(["Waiting to accept"]);
  });
  it("shows 'You're handling' for my chat and '<name> handling' for someone else's", () => {
    const { container } = show(
      [row({ id: "a", assignee_type: "human", assigned_to_user_id: "me" }), row({ id: "b", assignee_type: "human", assigned_to_user_id: "manish" })],
      { manish: "Manish" },
    );
    expect(chips(container)).toEqual(["You're handling", "Manish handling"]);
  });
  it("falls back to 'A teammate' when the name isn't known", () => {
    expect(chips(show([row({ assignee_type: "human", assigned_to_user_id: "x" })]).container)).toEqual(["A teammate handling"]);
  });
  it("other channels get no chip", () => {
    expect(chips(show([row({ provider: "whatsapp" }), row({ id: "w2", provider: "whatsapp", assignee_type: "human", assigned_to_user_id: "me" })]).container)).toEqual([]);
  });
});
