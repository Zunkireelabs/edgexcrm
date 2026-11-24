// @vitest-environment jsdom
//
// The new-chat pop-up under "quiet live updates": a faster backup poll, a second look after each live event, and a card
// that someone else accepted stays a moment as "taken care of" so a click can never land on a vanished card.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({
  handler: null as null | ((p: { new: Record<string, unknown> }) => void),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/leads" }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const ch = {
      on: (_t: string, _f: unknown, cb: (p: { new: Record<string, unknown> }) => void) => {
        h.handler = cb;
        return ch;
      },
      subscribe: () => ch,
    };
    return { channel: () => ch, removeChannel: () => {} };
  },
}));

import { IncomingChatPopup } from "./incoming-chat-popup";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
let pending: Row[];
let gets: number;
let dings: number;
let failing: boolean;
const chat = (id: string, name = "Ram Sharma"): Row => ({
  id, contact_display_name: name, contact_phone: null, last_message_preview: "Hi", last_message_at: new Date().toISOString(),
});
function setVisibility(v: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
  document.dispatchEvent(new Event("visibilitychange"));
}
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const live = () => document.querySelectorAll("[data-chat-card]");
const handled = () => document.querySelectorAll("[data-chat-handled]");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  pending = [];
  gets = 0;
  dings = 0;
  failing = false;
  h.handler = null;
  setVisibility("visible");
  window.localStorage.clear();
  class FakeAudio {
    currentTime = 0; destination = {};
    constructor() { dings += 1; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createOscillator() { return { type: "", frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }
  // @ts-expect-error test double
  window.AudioContext = FakeAudio;
  vi.stubGlobal("fetch", vi.fn(async () => {
    gets += 1;
    if (failing) throw new Error("offline");
    return { ok: true, json: async () => ({ data: pending.map((p) => ({ ...p })) }) };
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setVisibility("visible");
});

describe("pop-up: quiet refresh", () => {
  it("looks again every 15 s", async () => {
    render(<IncomingChatPopup tenantId="t" />);
    await tick(50);
    const base = gets;
    pending = [chat("c1")];
    await tick(15_100);
    expect(gets).toBeGreaterThan(base);
    expect(live()).toHaveLength(1);
  });

  it("a card someone else accepted stays ~2 s as 'taken care of', then goes", async () => {
    pending = [chat("c1")];
    render(<IncomingChatPopup tenantId="t" />);
    await tick(50);
    expect(live()).toHaveLength(1);
    pending = []; // a teammate accepted
    await tick(15_100);
    expect(live()).toHaveLength(0);
    expect(handled()).toHaveLength(1);
    expect(handled()[0].textContent).toContain("This chat was taken care of");
    await tick(2_100);
    expect(handled()).toHaveLength(0);
  });

  it("a chat you only opened with View does not flash as 'taken care of'", async () => {
    pending = [chat("c1")];
    render(<IncomingChatPopup tenantId="t" />);
    await tick(50);
    act(() => screen.getByRole("button", { name: "View" }).click());
    pending = [];
    await tick(15_100);
    expect(handled()).toHaveLength(0);
  });

  it("chimes for a NEW chat only, never for a refresh of the same ones", async () => {
    pending = [chat("c1")];
    render(<IncomingChatPopup tenantId="t" />);
    await tick(50);
    expect(dings).toBe(0); // first load is silent
    await tick(15_100);
    await tick(15_100);
    expect(dings).toBe(0);
    pending = [chat("c1"), chat("c2", "Sita")];
    await tick(15_100);
    expect(dings).toBe(1);
    await tick(15_100);
    expect(dings).toBe(1);
  });

  it("a live event refreshes now and again 1.5 s later", async () => {
    render(<IncomingChatPopup tenantId="t" />);
    await tick(50);
    const base = gets;
    act(() => h.handler?.({ new: { author_type: "customer", conversation_id: "c9" } }));
    await tick(400);
    expect(gets).toBe(base + 1);
    await tick(1_500);
    expect(gets).toBe(base + 2);
  });

  it("pauses while the tab is hidden and catches up when it returns", async () => {
    render(<IncomingChatPopup tenantId="t" />);
    await tick(50);
    setVisibility("hidden");
    const base = gets;
    pending = [chat("c1")];
    await tick(60_000);
    expect(gets).toBe(base);
    expect(live()).toHaveLength(0);
    setVisibility("visible");
    await tick(50);
    expect(live()).toHaveLength(1);
  });

  it("stays silent and keeps its cards when the network fails", async () => {
    pending = [chat("c1")];
    render(<IncomingChatPopup tenantId="t" />);
    await tick(50);
    failing = true;
    await tick(60_000);
    expect(live()).toHaveLength(1);
    expect(handled()).toHaveLength(0);
  });
});
