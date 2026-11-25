// @vitest-environment jsdom
//
// What the team sees when the AI answers website chats: the "AI" label on its messages, the badge on the pop-up card, and the
// per-chat AI switch in the side panel.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/leads" }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const ch = { on: () => ch, subscribe: () => ch };
    return { channel: () => ch, removeChannel: vi.fn() };
  },
}));

import { MessageThread } from "./MessageThread";
import { ContactPanel } from "./ContactPanel";
import { IncomingChatPopup } from "./incoming-chat-popup";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  h.toast.success.mockClear();
  h.toast.error.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const conv = (over: Row = {}): Row => ({
  id: "conv-1", provider: "chatwoot", channel_id: "ch1", external_contact_id: "x", contact_display_name: "Ram Sharma", contact_phone: null,
  status: "open", assignee_type: "unassigned", assigned_to_user_id: null, ai_autonomy: "autonomous", lead_id: null, meta: {}, ...over,
});

describe("AI messages in the thread", () => {
  it("are labelled 'AI' (a draft keeps 'AI suggested')", () => {
    const base = { direction: "outbound", author_type: "ai_agent", attachments: [], created_at: "2026-11-25T10:00:00Z" };
    render(
      <MessageThread
        conversation={conv()}
        messages={[
          { ...base, id: "m1", content_text: "The UK has great universities.", status: "sent" },
          { ...base, id: "m2", content_text: "Draft text", status: "draft" },
        ]}
        loading={false} currentUserId="me" userRole="staff" ownerName={null}
        onAccept={vi.fn(async () => {})} onTakeOver={vi.fn(async () => {})} onHandover={vi.fn()} onSend={vi.fn(async () => {})} onApproveDraft={vi.fn(async () => {})}
      />,
    );
    expect(Array.from(document.querySelectorAll("[data-ai-label]")).map((e) => e.textContent)).toEqual(["AI", "AI suggested"]);
  });
});

describe("the per-chat AI switch", () => {
  function panel(c: Row, canManage = true) {
    const onConversationUpdate = vi.fn();
    render(<ContactPanel conversation={c} tenantId="t1" userRole="admin" onConversationUpdate={onConversationUpdate} ownerName={null} canManage={canManage} />);
    return onConversationUpdate;
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
  });

  it("turns AI off for the chat with a PATCH", async () => {
    const update = panel(conv());
    fireEvent.click(document.querySelector("[data-ai-switch]")!);
    await waitFor(() => expect(update).toHaveBeenCalled());
    const patch = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).endsWith("/api/v1/inbox/conversations/conv-1"));
    expect(JSON.parse(patch![1].body)).toEqual({ ai_autonomy: "off" });
  });

  it("turns it back on from 'AI off'", async () => {
    panel(conv({ ai_autonomy: "off" }));
    expect(document.querySelector("[data-ai-switch]")).toHaveTextContent("AI off");
    fireEvent.click(document.querySelector("[data-ai-switch]")!);
    await waitFor(() => expect(h.toast.success).toHaveBeenCalled());
    const patch = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).endsWith("/api/v1/inbox/conversations/conv-1"));
    expect(JSON.parse(patch![1].body)).toEqual({ ai_autonomy: "autonomous" });
  });

  it("is just text for someone who may not change the chat, and for other channels", () => {
    panel(conv(), false);
    expect(document.querySelector("[data-ai-switch]")).toBeNull();
    cleanup();
    panel(conv({ provider: "whatsapp" }));
    expect(document.querySelector("[data-ai-switch]")).toBeNull();
  });

  it("shows why a person is needed when the AI handed the chat over", () => {
    panel(conv({ ai_autonomy: "off", meta: { needs_human: { at: "2026-11-25T10:00:00Z", reason: "out_of_knowledge" } } }));
    expect(document.querySelector("[data-needs-human]")).toHaveTextContent("A person needs to reply");
  });
});

describe("the new-chat pop-up", () => {
  const show = async (chat: Row) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify({ data: String(url).includes("pending-claims") ? [chat] : [] }), { status: 200 })));
    render(<IncomingChatPopup tenantId="tenant-a" />);
    return await waitFor(() => {
      const el = document.querySelector("[data-chat-kind]");
      if (!el) throw new Error("no card yet");
      return el as HTMLElement;
    });
  };
  const chat = { id: "c1", contact_display_name: "Ram", contact_phone: null, last_message_preview: "Hi", last_message_at: new Date().toISOString() };

  it("a chat that needs a person says so", async () => {
    const el = await show({ ...chat, needs_human: true });
    expect(el.dataset.chatKind).toBe("needs-human");
    expect(el).toHaveTextContent("Needs a human");
    expect(screen.getByRole("button", { name: /Accept/ })).toBeInTheDocument();
  });

  it("a chat the AI is answering says so, and can still be accepted", async () => {
    const el = await show({ ...chat, ai_replying: true });
    expect(el.dataset.chatKind).toBe("ai-replying");
    expect(el).toHaveTextContent("AI is replying");
    expect(el).toHaveTextContent("New website chat");
  });

  it("a plain waiting chat looks as before", async () => {
    const el = await show(chat);
    expect(el.dataset.chatKind).toBe("new");
    expect(el).not.toHaveTextContent("AI is replying");
  });
});
