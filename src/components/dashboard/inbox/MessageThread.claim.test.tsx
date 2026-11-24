// @vitest-environment jsdom
//
// The chat view for website chats: Accept when nobody has it, a lock when someone else does, Hand over for the owner,
// grey team notes. Other channels (WhatsApp) must look exactly as before.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MessageThread } from "./MessageThread";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const conv = (over: Row = {}): Row => ({
  id: "conv-1", provider: "chatwoot", external_contact_id: "x", contact_display_name: "Ram Sharma",
  assignee_type: "unassigned", assigned_to_user_id: null, ...over,
});
const msg = (over: Row = {}): Row => ({
  id: "m1", direction: "inbound", author_type: "customer", content_text: "Hi, I want to study in the UK",
  attachments: [], status: "received", created_at: "2026-11-24T10:00:00Z", ...over,
});

function show(over: { conversation?: Row; messages?: Row[]; userId?: string; role?: string } & Row = {}) {
  const handlers = { onAccept: vi.fn(async () => {}), onTakeOver: vi.fn(async () => {}), onHandover: vi.fn(), onSend: vi.fn(async () => {}), onApproveDraft: vi.fn(async () => {}) };
  render(
    <MessageThread
      conversation={over.conversation ?? conv()}
      messages={over.messages ?? [msg()]}
      loading={false}
      currentUserId={over.userId ?? "me"}
      userRole={over.role ?? "staff"}
      ownerName={"ownerName" in over ? (over.ownerName as string | null) : "Manish"}
      {...handlers}
    />,
  );
  return handlers;
}
const composer = () => screen.queryByPlaceholderText(/Type a message/);

describe("website chat nobody has accepted", () => {
  it("shows Accept instead of a reply box, and a 'waiting' chip", () => {
    show();
    expect(screen.getByText("Nobody is handling this chat yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accept this chat/ })).toBeInTheDocument();
    expect(screen.getByText("Waiting to accept")).toBeInTheDocument();
    expect(composer()).toBeNull();
  });
  it("clicking Accept calls onAccept", async () => {
    const h = show();
    fireEvent.click(screen.getByRole("button", { name: /Accept this chat/ }));
    await waitFor(() => expect(h.onAccept).toHaveBeenCalledTimes(1));
  });
  it("a second click while the first is still working does nothing (no double accept)", async () => {
    let release: () => void = () => {};
    const onAccept = vi.fn(() => new Promise<void>((r) => (release = r)));
    render(<MessageThread conversation={conv()} messages={[msg()]} loading={false} currentUserId="me" userRole="staff" onSend={vi.fn()} onApproveDraft={vi.fn()} onAccept={onAccept} />);
    const btn = screen.getByRole("button", { name: /Accept this chat/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onAccept).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(btn).not.toBeDisabled());
  });
});

describe("website chat I accepted", () => {
  const mine = () => conv({ assignee_type: "human", assigned_to_user_id: "me" });
  it("shows the normal reply box, a 'You're handling' chip and Hand over", () => {
    show({ conversation: mine() });
    expect(composer()).toBeInTheDocument();
    expect(screen.getByText("You're handling")).toBeInTheDocument();
    expect(screen.queryByText("Nobody is handling this chat yet.")).toBeNull();
  });
  it("Hand over opens the hand-over flow", () => {
    const h = show({ conversation: mine() });
    fireEvent.click(screen.getByRole("button", { name: "Hand over" }));
    expect(h.onHandover).toHaveBeenCalledTimes(1);
  });
});

describe("website chat someone else is handling", () => {
  const theirs = () => conv({ assignee_type: "human", assigned_to_user_id: "manish" });
  it("locks the reply box and says who is handling it", () => {
    show({ conversation: theirs() });
    expect(composer()).toBeNull();
    expect(screen.getByText("Manish is handling this chat.")).toBeInTheDocument();
    expect(screen.getByText("Manish handling")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hand over" })).toBeNull();
  });
  it("a normal teammate has no Take over", () => {
    show({ conversation: theirs(), role: "staff" });
    expect(screen.queryByRole("button", { name: "Take over" })).toBeNull();
  });
  it("an admin gets Take over, and it calls onTakeOver", async () => {
    const h = show({ conversation: theirs(), role: "admin" });
    fireEvent.click(screen.getByRole("button", { name: "Take over" }));
    await waitFor(() => expect(h.onTakeOver).toHaveBeenCalledTimes(1));
  });
  it("falls back to 'A teammate' when the owner's name isn't known", () => {
    show({ conversation: theirs(), ownerName: null });
    expect(screen.getByText("A teammate is handling this chat.")).toBeInTheDocument();
  });
});

describe("other channels are unchanged", () => {
  it("an unassigned WhatsApp chat still has the reply box and no accept/lock/chip", () => {
    show({ conversation: conv({ provider: "whatsapp" }) });
    expect(composer()).toBeInTheDocument();
    expect(screen.queryByText("Waiting to accept")).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept this chat/ })).toBeNull();
    expect(screen.queryByText(/is handling this chat/)).toBeNull();
  });
  it("a WhatsApp chat assigned to someone else is NOT locked", () => {
    show({ conversation: conv({ provider: "whatsapp", assignee_type: "human", assigned_to_user_id: "manish" }) });
    expect(composer()).toBeInTheDocument();
  });
});

describe("grey team notes", () => {
  const note = () => msg({ id: "n1", direction: "outbound", author_type: "system", content_text: "Manish accepted this chat", status: "sent" });
  it("shows a note as a small centred grey line, not a message bubble", () => {
    const { container } = render(
      <MessageThread conversation={conv({ assignee_type: "human", assigned_to_user_id: "me" })} messages={[msg(), note()]} loading={false} currentUserId="me" userRole="staff" onSend={vi.fn()} onApproveDraft={vi.fn()} />,
    );
    const el = container.querySelector("[data-system-note]");
    expect(el).toHaveTextContent("Manish accepted this chat");
    expect(el!.className).toContain("text-muted-foreground");
    expect(el!.className).not.toContain("bg-primary");
  });
});

describe("draft approval follows the same rule as replying", () => {
  const draft = () => msg({ id: "d1", direction: "outbound", author_type: "ai_agent", status: "draft", content_text: "Suggested reply" });
  it("the owner (and non-website chats) can approve a draft", () => {
    show({ conversation: conv({ assignee_type: "human", assigned_to_user_id: "me" }), messages: [draft()] });
    expect(screen.getByTitle("Approve draft")).toBeInTheDocument();
    cleanup();
    show({ conversation: conv({ provider: "whatsapp" }), messages: [draft()] });
    expect(screen.getByTitle("Approve draft")).toBeInTheDocument();
  });
  it("nobody can approve a draft on a chat they don't own, or that nobody has accepted", () => {
    show({ conversation: conv({ assignee_type: "human", assigned_to_user_id: "manish" }), messages: [draft()] });
    expect(screen.queryByTitle("Approve draft")).toBeNull();
    cleanup();
    show({ messages: [draft()] });
    expect(screen.queryByTitle("Approve draft")).toBeNull();
  });
});
