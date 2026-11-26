// @vitest-environment jsdom
//
// The app-wide "New website chat" pop-up. Network, live feed, sound and router are all faked; the fake server follows the
// same rules as the real routes (first accept wins).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  push: vi.fn(),
  removeChannel: vi.fn(),
  realtime: { handler: null as null | ((payload: { new: Record<string, unknown> }) => void) },
  pathname: { value: "/leads" },
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push }),
  usePathname: () => h.pathname.value,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const ch = {
      on: (_type: string, _filter: unknown, cb: (p: { new: Record<string, unknown> }) => void) => {
        h.realtime.handler = cb;
        return ch;
      },
      subscribe: () => ch,
    };
    return { channel: () => ch, removeChannel: h.removeChannel };
  },
}));

import { IncomingChatPopup } from "./incoming-chat-popup";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let pending: Row[];
let calls: { url: string; method: string }[];
let claim: { status: number; message?: string };
let claimGate: Promise<void> | null;
let dings: number;

const chat = (id: string, over: Row = {}): Row => ({
  id, contact_display_name: "Ram Sharma", contact_phone: null, last_message_preview: "Hi, I want to study in the UK",
  last_message_at: new Date().toISOString(), ...over,
});

beforeEach(() => {
  h.toast.success.mockClear(); h.toast.error.mockClear(); h.push.mockClear(); h.removeChannel.mockClear();
  h.realtime.handler = null;
  h.pathname.value = "/leads";
  pending = [];
  calls = [];
  claim = { status: 200 };
  claimGate = null;
  dings = 0;
  window.localStorage.clear();
  document.title = "Leads · EdgeX";

  class FakeAudio {
    currentTime = 0;
    destination = {};
    constructor() { dings += 1; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createOscillator() { return { type: "", frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }
  // @ts-expect-error test double
  window.AudioContext = FakeAudio;

  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/pending-claims")) return { ok: true, json: async () => ({ data: pending }) };
    if (url.includes("/claim") && method === "POST") {
      if (claimGate) await claimGate;
      if (claim.status === 200) {
        pending = pending.filter((p) => !url.includes(p.id));
        return { ok: true, json: async () => ({ data: {} }) };
      }
      return { ok: false, json: async () => ({ error: { message: claim.message } }) };
    }
    return { ok: false, json: async () => ({}) };
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const show = () => render(<IncomingChatPopup tenantId="tenant-a" />);
const cards = () => document.querySelectorAll("[data-chat-card]");
const emit = (row: Row) => act(async () => { h.realtime.handler?.({ new: row }); });
const claimCalls = () => calls.filter((c) => c.method === "POST");

describe("the card", () => {
  it("shows nothing when no website chat is waiting", async () => {
    show();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(cards()).toHaveLength(0);
    expect(document.querySelector("[data-incoming-chats]")).toBeNull();
  });

  it("shows a waiting chat with the visitor's name and what they wrote, with Accept and View", async () => {
    pending = [chat("c1")];
    show();
    expect(await screen.findByText("New website chat")).toBeInTheDocument();
    expect(screen.getByText("Ram Sharma")).toBeInTheDocument();
    expect(screen.getByText(/Hi, I want to study in the UK/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accept/ })).toBeInTheDocument();
  });

  it("falls back to the phone, then to 'A visitor', when there is no name", async () => {
    pending = [chat("c1", { contact_display_name: null, contact_phone: "+977 9800000000" }), chat("c2", { contact_display_name: null })];
    show();
    expect(await screen.findByText("+977 9800000000")).toBeInTheDocument();
    expect(screen.getByText("A visitor")).toBeInTheDocument();
  });

  it("shows at most 3 cards and says how many more are waiting; that link opens the Inbox", async () => {
    pending = [chat("a"), chat("b"), chat("c"), chat("d"), chat("e")];
    show();
    await screen.findByText("+2 more waiting · Open Inbox");
    expect(cards()).toHaveLength(3);
    fireEvent.click(screen.getByText("+2 more waiting · Open Inbox"));
    expect(h.push).toHaveBeenCalledWith("/inbox");
  });
});

describe("Accept", () => {
  it("accepts through the claim route, tells you, and opens that chat in the Inbox", async () => {
    pending = [chat("c1")];
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Accept/ }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/inbox?conversation=c1"));
    expect(claimCalls()).toEqual([{ url: "/api/v1/inbox/conversations/c1/claim", method: "POST" }]);
    expect(h.toast.success).toHaveBeenCalledWith("You're handling this chat");
    await waitFor(() => expect(cards()).toHaveLength(0)); // it was refreshed and is no longer waiting
  });

  it("a second click while the first is still working does nothing (no double accept)", async () => {
    let release: () => void = () => {};
    claimGate = new Promise<void>((r) => (release = r));
    pending = [chat("c1")];
    show();
    const btn = await screen.findByRole("button", { name: /Accept/ });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(claimCalls()).toHaveLength(1);
    release();
    await waitFor(() => expect(h.push).toHaveBeenCalledTimes(1));
  });

  it("if someone was faster, shows who, does not open the chat, and the card goes away", async () => {
    pending = [chat("c1")];
    claim = { status: 409, message: "Bijay is already handling this chat." };
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Accept/ }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Bijay is already handling this chat."));
    expect(h.push).not.toHaveBeenCalled();
    pending = []; // the server no longer lists it
    await emit({ conversation_id: "c1", author_type: "system" });
    await waitFor(() => expect(cards()).toHaveLength(0));
  });
});

describe("View", () => {
  it("opens the chat without accepting it, and hides the card", async () => {
    pending = [chat("c1")];
    show();
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    expect(h.push).toHaveBeenCalledWith("/inbox?conversation=c1");
    expect(claimCalls()).toHaveLength(0);
    await waitFor(() => expect(cards()).toHaveLength(0));
  });

  it("a viewed chat doesn't come back on the next check, but does when the visitor writes again", async () => {
    pending = [chat("c1")];
    show();
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    await emit({ conversation_id: "other", author_type: "system" }); // a refresh happens; c1 is still pending on the server
    await waitFor(() => expect(calls.filter((c) => c.url.includes("pending-claims")).length).toBeGreaterThan(1));
    expect(cards()).toHaveLength(0);

    await emit({ conversation_id: "c1", author_type: "customer" }); // the visitor wrote again
    await waitFor(() => expect(cards()).toHaveLength(1));
  });
});

describe("live updates", () => {
  it("a visitor's new message makes a card appear without waiting for the 30-second check", async () => {
    show();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    pending = [chat("c9", { contact_display_name: "Sita Rai" })];
    await emit({ conversation_id: "c9", author_type: "customer" });
    expect(await screen.findByText("Sita Rai")).toBeInTheDocument();
  });

  it("the card disappears for everyone else when someone accepts (the grey note arrives)", async () => {
    pending = [chat("c1")];
    show();
    await screen.findByText("Ram Sharma");
    pending = []; // another person accepted it
    await emit({ conversation_id: "c1", author_type: "system" });
    await waitFor(() => expect(cards()).toHaveLength(0));
  });

  it("checks again every 30 seconds in case the live feed missed something", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show();
    await waitFor(() => expect(calls.filter((c) => c.url.includes("pending-claims"))).toHaveLength(1));
    pending = [chat("late")];
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(await screen.findByText("Ram Sharma")).toBeInTheDocument();
    expect(calls.filter((c) => c.url.includes("pending-claims")).length).toBeGreaterThanOrEqual(2);
  });

  it("stays quiet if the list can't be loaded, and stops listening when it goes away", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { unmount } = show();
    await act(async () => { await Promise.resolve(); });
    expect(cards()).toHaveLength(0);
    unmount();
    expect(h.removeChannel).toHaveBeenCalledTimes(1);
  });
});

describe("the soft chime", () => {
  it("does not play on the first load, even with chats already waiting", async () => {
    pending = [chat("c1")];
    show();
    await screen.findByText("Ram Sharma");
    expect(dings).toBe(0);
  });

  it("plays once for a NEW chat that arrives afterwards", async () => {
    show();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    pending = [chat("c1")];
    await emit({ conversation_id: "c1", author_type: "customer" });
    await screen.findByText("Ram Sharma");
    expect(dings).toBe(1);
  });

  it("does not play again when a chat already shown gets another message", async () => {
    show();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    pending = [chat("c1")];
    await emit({ conversation_id: "c1", author_type: "customer" });
    await screen.findByText("Ram Sharma");
    pending = [chat("c1", { last_message_preview: "Are you there?" })];
    await emit({ conversation_id: "c1", author_type: "customer" });
    await screen.findByText(/Are you there/);
    expect(dings).toBe(1);
  });

  it("can be muted, stays muted next time, and a muted chat plays nothing", async () => {
    show();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    pending = [chat("c1")];
    await emit({ conversation_id: "c1", author_type: "customer" });
    await screen.findByText("Sound on · mute");
    dings = 0;
    fireEvent.click(screen.getByText("Sound on · mute"));
    expect(screen.getByText("Sound off · turn on")).toBeInTheDocument();
    expect(window.localStorage.getItem("edgex:chat-sound-muted")).toBe("1");

    pending = [chat("c1"), chat("c2")];
    await emit({ conversation_id: "c2", author_type: "customer" });
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(dings).toBe(0);
  });

  it("starts muted if that was chosen before", async () => {
    window.localStorage.setItem("edgex:chat-sound-muted", "1");
    pending = [chat("c1")];
    show();
    expect(await screen.findByText("Sound off · turn on")).toBeInTheDocument();
  });
});

describe("the browser tab", () => {
  it("shows '(1) New chat · EdgeX' while a chat waits, and puts the page's own title back afterwards", async () => {
    pending = [chat("c1")];
    show();
    await waitFor(() => expect(document.title).toBe("(1) New chat · EdgeX"));
    pending = [];
    await emit({ conversation_id: "c1", author_type: "system" });
    await waitFor(() => expect(document.title).toBe("Leads · EdgeX"));
  });

  it("counts several waiting chats", async () => {
    pending = [chat("a"), chat("b")];
    show();
    await waitFor(() => expect(document.title).toBe("(2) New chat · EdgeX"));
  });
});
