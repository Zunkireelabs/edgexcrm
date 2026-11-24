// @vitest-environment jsdom
//
// "Quiet live updates": the Inbox keeps itself fresh in the background (a 12 s backup under the live feed) and must never
// get in the person's way. The whole screen runs here with a fake server, a fake live feed and a fake clock.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  handlers: [] as Array<(p?: { new: Record<string, unknown> }) => void>,
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("conversation=conv-1"),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/inbox",
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const ch = {
      on: (_t: string, _f: unknown, cb: (p?: { new: Record<string, unknown> }) => void) => {
        h.handlers.push(cb);
        return ch;
      },
      subscribe: () => ch,
    };
    return { channel: () => ch, removeChannel: () => {} };
  },
}));

import { InboxUI } from "./InboxUI";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let conv: Row;
let messages: Row[];
let msgGets: number;
let inFlight: number;
let maxInFlight: number;
let gate: Promise<void> | null;
let failing: boolean;

const MEMBERS = [
  { user_id: "me", name: "Manish Sah" },
  { user_id: "bijay", name: "Bijay Dahal" },
];
const customer = (id: string, text: string): Row => ({
  id, direction: "inbound", author_type: "customer", content_text: text, attachments: [], status: "received", created_at: "2026-11-24T10:00:00Z",
});
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) });

function setVisibility(v: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Element.prototype.scrollIntoView = vi.fn();
  h.toast.success.mockClear();
  h.toast.error.mockClear();
  h.handlers.length = 0;
  msgGets = 0;
  inFlight = 0;
  maxInFlight = 0;
  gate = null;
  failing = false;
  setVisibility("visible");
  messages = [customer("m1", "Hi, I want to study in the UK")];
  conv = {
    id: "conv-1", provider: "chatwoot", channel_id: "ch1", external_contact_id: "x", contact_display_name: "Ram Sharma",
    last_message_preview: "Hi", last_message_at: "2026-11-24T10:00:00Z", unread_count: 0, status: "open",
    assignee_type: "human", assigned_to_user_id: "me", lead_id: null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/handover-targets")) return ok(MEMBERS);
      if (url.includes("/messages")) {
        msgGets += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          if (gate) await gate;
          if (failing) throw new Error("offline");
          return ok(messages.map((m) => ({ ...m })));
        } finally {
          inFlight -= 1;
        }
      }
      if (url.includes("/api/v1/inbox/conversations")) {
        if (failing) throw new Error("offline");
        return ok([{ ...conv }]);
      }
      return ok([]);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setVisibility("visible");
});

const show = (role = "staff") =>
  render(<InboxUI tenantId="t" userId="me" userRole={role} initialChannels={[]} initialConversations={[conv]} />);
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const composer = () => screen.getByPlaceholderText(/Type a message/) as HTMLTextAreaElement;
const settle = async () => {
  await screen.findByText("Hi, I want to study in the UK");
};

describe("quiet refresh in the Inbox", () => {
  it("brings in a new message on its own within 12 s, without any live event", async () => {
    show();
    await settle();
    messages = [...messages, customer("m2", "Are you there?")];
    await tick(12_100);
    expect(screen.getByText("Are you there?")).toBeInTheDocument();
  });

  it("what you are typing survives a refresh: text, focus and cursor stay put", async () => {
    show();
    await settle();
    const box = composer();
    box.focus();
    fireEvent.change(box, { target: { value: "Hello Ram, thanks for wri" } });
    box.setSelectionRange(5, 5);
    messages = [...messages, customer("m2", "Are you there?")];
    await tick(12_100);
    expect(screen.getByText("Are you there?")).toBeInTheDocument();
    expect(composer()).toBe(box); // the very same box, not a new one
    expect(box.value).toBe("Hello Ram, thanks for wri");
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe(5);
  });

  it("never shows 'Loading…' or blanks the thread while a refresh is running", async () => {
    show();
    await settle();
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    await tick(12_100); // refresh starts and waits on the server
    expect(msgGets).toBeGreaterThan(1);
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getByText("Hi, I want to study in the UK")).toBeInTheDocument();
    release();
    await tick(10);
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("redraws nothing when nothing changed", async () => {
    const { container } = show();
    await settle();
    await tick(100);
    const seen: MutationRecord[] = [];
    const obs = new MutationObserver((r) => seen.push(...r));
    obs.observe(container, { subtree: true, childList: true, characterData: true, attributes: true });
    const before = msgGets;
    await tick(12_100);
    seen.push(...obs.takeRecords());
    obs.disconnect();
    expect(msgGets).toBeGreaterThan(before); // it did look
    expect(seen).toHaveLength(0); // and changed nothing on screen
  });

  it("keeps your scroll position when you are reading older messages, and offers a chip instead", async () => {
    show();
    await settle();
    await tick(50); // let the first-load scroll finish before we scroll up
    const scroller = screen.getByText("Hi, I want to study in the UK").closest("div.overflow-y-auto") as HTMLElement;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
    scroller.scrollTop = 100; // scrolled up, far from the bottom
    fireEvent.scroll(scroller);
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    messages = [...messages, customer("m2", "Are you there?")];
    await tick(12_100);
    expect(screen.getByText("Are you there?")).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(100);
    const chip = screen.getByText("New messages ↓");
    fireEvent.click(chip);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByText("New messages ↓")).toBeNull();
  });

  it("follows new messages when you are already at the bottom (no chip)", async () => {
    show();
    await settle();
    await tick(50);
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    messages = [...messages, customer("m2", "Are you there?")];
    await tick(12_100);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByText("New messages ↓")).toBeNull();
  });

  it("leaves an open Hand over dialog alone, with its choice", async () => {
    show();
    await settle();
    await tick(10);
    fireEvent.click(screen.getByRole("button", { name: "Hand over" }));
    const select = (await screen.findByLabelText("Hand over to")) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "bijay" } });
    messages = [...messages, customer("m2", "Are you there?")];
    await tick(12_100);
    expect(screen.getByText("Are you there?")).toBeInTheDocument();
    expect(screen.getByLabelText("Hand over to")).toBe(select);
    expect(select.value).toBe("bijay");
  });

  it("pauses while the tab is hidden and catches up when it comes back", async () => {
    show();
    await settle();
    setVisibility("hidden");
    const before = msgGets;
    messages = [...messages, customer("m2", "Are you there?")];
    await tick(60_000);
    expect(msgGets).toBe(before); // not one request while hidden
    expect(screen.queryByText("Are you there?")).toBeNull();
    setVisibility("visible");
    await tick(50);
    expect(screen.getByText("Are you there?")).toBeInTheDocument(); // caught up at once
  });

  it("never runs two refreshes at the same time, even when the server is slow", async () => {
    show();
    await settle();
    gate = new Promise<void>(() => {}); // the server never answers
    await tick(60_000);
    expect(maxInFlight).toBe(1);
  });

  it("stays silent when the network fails: no pop-up, the screen keeps what it has", async () => {
    show();
    await settle();
    failing = true;
    await tick(60_000);
    expect(h.toast.error).not.toHaveBeenCalled();
    expect(screen.getByText("Hi, I want to study in the UK")).toBeInTheDocument();
    failing = false;
    messages = [...messages, customer("m2", "Are you there?")];
    await tick(65_000); // after backing off, it recovers by itself
    expect(screen.getByText("Are you there?")).toBeInTheDocument();
  });

  it("a live event refreshes now and once more 1.5 s later (the message can land before the chat is updated)", async () => {
    show();
    await settle();
    await tick(100);
    const before = msgGets;
    act(() => h.handlers[0]());
    await tick(50);
    expect(msgGets).toBe(before + 1);
    await tick(1_500);
    expect(msgGets).toBe(before + 2);
  });

  it("long chats: the server only lists the first 50, so a message that arrived live must stay on screen", async () => {
    show();
    await settle();
    // The server keeps listing only the first window (just m1), like a chat with more than 50 messages.
    const newer = { ...customer("m51", "Message number 51"), conversation_id: "conv-1", created_at: "2026-11-24T11:00:00Z" };
    gate = new Promise<void>(() => {}); // no network answer at all: it must come straight from the live event
    act(() => h.handlers[0]({ new: newer }));
    expect(screen.getByText("Message number 51")).toBeInTheDocument();
    gate = null;
    await tick(12_100); // the quiet refresh runs against a server that does not list m51
    expect(screen.getByText("Message number 51")).toBeInTheDocument(); // still there
    expect(screen.getByText("Hi, I want to study in the UK")).toBeInTheDocument();
  });

  it("a live message for a different chat is not put on this screen", async () => {
    show();
    await settle();
    act(() => h.handlers[0]({ new: { ...customer("x1", "Someone else's chat"), conversation_id: "conv-2" } }));
    expect(screen.queryByText("Someone else's chat")).toBeNull();
  });

  it("the live connection is made once, with INSERT and UPDATE listeners", async () => {
    show();
    await settle();
    expect(h.handlers.length).toBe(2); // INSERT + UPDATE, made once
  });

  it("if someone takes the chat while you are typing, the box locks but your words are kept and shown", async () => {
    show();
    await settle();
    fireEvent.change(composer(), { target: { value: "Hello Ram, one moment" } });
    conv = { ...conv, assigned_to_user_id: "bijay" };
    messages = [...messages, { ...customer("n1", "Bijay Dahal took over this chat"), author_type: "system" }];
    await tick(12_100);
    expect(screen.queryByPlaceholderText(/Type a message/)).toBeNull(); // locked
    const kept = document.querySelector("[data-unsent-draft]") as HTMLElement;
    expect(kept).not.toBeNull();
    expect(kept.textContent).toContain("Hello Ram, one moment");
    expect(kept.textContent).toContain("kept here so you can copy it");
  });
});
