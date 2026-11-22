// @vitest-environment jsdom

// The widget's real transport: session from EdgeX, then Chatwoot's public client API, signed on every call.
// Runs the real public/chat-widget/chat-widget.js in a simulated browser with a fake fetch and fake timers.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const SOURCE = readFileSync(path.join(process.cwd(), "public/chat-widget/chat-widget.js"), "utf8");
type Chat = { init: (config?: unknown) => unknown };
const load = (): Chat => {
  new Function(SOURCE).call(window);
  return (window as unknown as { ZunkireeChat: Chat }).ZunkireeChat;
};

const root = () => document.getElementById("zk-chat-host")!.shadowRoot!;
const q = <T extends Element>(sel: string) => root().querySelector(sel) as T | null;
const click = (el: Element | null) => (el as HTMLElement).click();

const INBOX = "AbCdEfGhIjKlMnOpQrStUvWx";
const CONFIG = {
  brand: { name: "Admizz Education" },
  agent: { name: "Admizz counsellors", initials: "AE" },
  connection: { inbox: INBOX, api: "https://crm.example.com" },
  contact: { when: "before", defaultCountryCode: "+977" },
};

type Call = { method: string; url: string; body: Record<string, unknown> | null; init: RequestInit };
let calls: Call[];
let outgoing: Array<{ id: number; message_type: number; content: string }>;
let handler: (call: Call) => { status?: number; json?: unknown } | undefined;

const SESSION = { data: { chatwootBaseUrl: "https://inbox.example.com", inboxIdentifier: INBOX, identifier: "vis-1", identifierHash: "hash-1" } };

function defaultHandler(c: Call) {
  if (c.url.endsWith("/api/public/chat/session")) return { json: SESSION };
  if (c.url.endsWith("/contacts")) return { json: { source_id: "src-1" } };
  if (c.url.endsWith("/conversations")) return { json: { id: 5 } };
  if (c.method === "POST" && c.url.endsWith("/messages")) return { json: { id: 100 } };
  if (c.method === "GET") return { json: outgoing };
  if (c.method === "PATCH") return { json: {} };
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  document.body.innerHTML = "";
  delete (window as unknown as { ZunkireeChat?: unknown }).ZunkireeChat;
  calls = [];
  outgoing = [];
  handler = defaultHandler;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call: Call = { method: init.method ?? "GET", url, body: init.body ? JSON.parse(init.body as string) : null, init };
      calls.push(call);
      const r = handler(call) ?? { status: 404, json: {} };
      return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
    })
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flush = () => vi.advanceTimersByTimeAsync(20);
const trail = () => calls.map((c) => `${c.method} ${c.url.replace("https://crm.example.com", "").replace("https://inbox.example.com", "")}`);

function fillForm(v: { name?: string; phone?: string; email?: string; trap?: string }) {
  const set = (sel: string, value?: string) => {
    const el = q<HTMLInputElement>(sel);
    if (el && value !== undefined) el.value = value;
  };
  set('input[aria-label="Your name"]', v.name);
  set('input[aria-label="WhatsApp number"]', v.phone);
  set('input[aria-label="Email"]', v.email);
  set('input[name="website"]', v.trap);
  q<HTMLFormElement>(".card form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}
function typeAndSend(text: string) {
  const ta = q<HTMLTextAreaElement>("textarea")!;
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  click(q(".send"));
}
/** Opens the chat, fills the form, and sends one message, like a visitor would. */
async function chat(details: { name?: string; phone?: string; email?: string; trap?: string } = { name: "Sneha", phone: "9800000000", email: "s@example.com" }, text = "Hello there") {
  load().init(CONFIG);
  click(q(".launcher"));
  click(q(".start"));
  fillForm(details);
  typeAndSend(text);
  await flush();
}

describe("the real transport", () => {
  it("talks to nobody until the visitor actually sends something", async () => {
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    await flush();
    expect(calls).toHaveLength(0);
  });

  it("asks EdgeX for a signed id first, then creates the contact, the conversation and the message, signing each call", async () => {
    await chat();
    expect(trail()).toEqual([
      "POST /api/public/chat/session",
      `POST /public/api/v1/inboxes/${INBOX}/contacts`,
      `POST /public/api/v1/inboxes/${INBOX}/contacts/src-1/conversations`,
      `POST /public/api/v1/inboxes/${INBOX}/contacts/src-1/conversations/5/messages`,
    ]);
    expect(calls[0].body).toEqual({ inbox: INBOX });
    expect(calls[1].body).toEqual({ identifier: "vis-1", identifier_hash: "hash-1", name: "Sneha", email: "s@example.com", phone_number: "+9779800000000" });
    expect(calls[2].body).toEqual({ identifier_hash: "hash-1" });
    expect(calls[3].body).toEqual({ content: "Hello there", identifier_hash: "hash-1" });
    // No cookies or credentials are ever sent with these cross-site calls.
    for (const c of calls) expect(c.init.credentials).toBe("omit");
  });

  it("uses the same session for the next message, without asking EdgeX again", async () => {
    await chat();
    calls.length = 0;
    typeAndSend("Another question");
    await flush();
    expect(trail()).toEqual([`POST /public/api/v1/inboxes/${INBOX}/contacts/src-1/conversations/5/messages`]);
  });

  it.each([
    ["adds the default country code to a local number", "98-00000000", "+97798 00000000".replace(/\s/g, "")],
    ["drops a leading zero before adding it", "09800000000", "+9779800000000"],
    ["keeps an international number as typed", "+44 7700 900123", "+447700900123"],
    ["turns 00 into +", "0044 7700 900123", "+447700900123"],
  ])("phone: %s", async (_name, typed, expected) => {
    await chat({ name: "A", phone: typed });
    expect(calls[1].body).toMatchObject({ phone_number: expected });
  });

  it("keeps a number Chatwoot could never accept as text on the contact instead of failing", async () => {
    // No default country code configured, and the number has no "+": we cannot make it international.
    load().init({ ...CONFIG, contact: { when: "before", defaultCountryCode: "" } });
    click(q(".launcher"));
    click(q(".start"));
    fillForm({ name: "A", phone: "9800000000" });
    typeAndSend("Hi");
    await flush();
    expect(calls[1].body).not.toHaveProperty("phone_number");
    expect(calls[1].body).toMatchObject({ custom_attributes: { whatsapp_as_typed: "9800000000" } });
  });

  it("retries once without the number when Chatwoot rejects it, and the chat still goes through", async () => {
    handler = (c) => (c.url.endsWith("/contacts") && c.body?.phone_number ? { status: 422, json: {} } : defaultHandler(c));
    await chat({ name: "A", phone: "9800000000" });
    expect(trail().filter((t) => t.endsWith("/contacts"))).toHaveLength(2);
    expect(calls[2].body).not.toHaveProperty("phone_number");
    expect(trail().at(-1)).toMatch(/\/messages$/);
  });
});

describe("receiving replies", () => {
  it("shows a counsellor's reply once, never the visitor's own message, and does not repeat it", async () => {
    await chat();
    outgoing = [
      { id: 100, message_type: 0, content: "Hello there" },
      { id: 101, message_type: 1, content: "Hi Sneha, counsellor here" },
    ];
    await vi.advanceTimersByTimeAsync(5000);
    const texts = () => Array.from(root().querySelectorAll(".m")).map((m) => m.textContent);
    expect(texts().filter((t) => t === "Hi Sneha, counsellor here")).toHaveLength(1);
    expect(texts().filter((t) => t === "Hello there")).toHaveLength(1); // only the one the visitor sent

    await vi.advanceTimersByTimeAsync(5000); // the next check returns the same list
    expect(texts().filter((t) => t === "Hi Sneha, counsellor here")).toHaveLength(1);

    outgoing.push({ id: 102, message_type: 1, content: "Which course?" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(texts().filter((t) => t === "Which course?")).toHaveLength(1);
  });

  it("checks every five seconds, signing the request", async () => {
    await chat();
    calls.length = 0;
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain(`/conversations/5/messages?identifier_hash=hash-1`);
  });

  it("does not check while the page is hidden", async () => {
    await chat();
    calls.length = 0;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(15000);
    expect(calls).toHaveLength(0);
  });

  it("backs off while the server is failing, then recovers", async () => {
    await chat();
    calls.length = 0;
    handler = () => ({ status: 503, json: {} });
    await vi.advanceTimersByTimeAsync(5000); // fails, next check in 10s
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(2);
  });

  it("keeps the conversation when the page is reloaded, without asking EdgeX again", async () => {
    await chat();
    outgoing = [{ id: 101, message_type: 1, content: "Welcome back" }];
    // A real reload also kills the old page's timers.
    vi.clearAllTimers();
    document.body.innerHTML = "";
    delete (window as unknown as { ZunkireeChat?: unknown }).ZunkireeChat;
    calls.length = 0;
    load().init(CONFIG);
    await vi.advanceTimersByTimeAsync(5000);
    expect(trail().some((t) => t.includes("/api/public/chat/session"))).toBe(false);
    expect(trail()).toEqual([`GET /public/api/v1/inboxes/${INBOX}/contacts/src-1/conversations/5/messages?identifier_hash=hash-1`]);
  });
});

describe("when things go wrong", () => {
  it("tells the visitor plainly when the chat cannot start, and talks to Chatwoot not at all", async () => {
    handler = () => ({ status: 503, json: { error: { code: "UNAVAILABLE" } } });
    await chat();
    expect(trail()).toEqual(["POST /api/public/chat/session"]);
    const text = root().textContent ?? "";
    expect(text).toContain("We could not reach the team just now");
    expect(text).toContain("Hello there"); // their message stays on screen
  });

  it("tells the visitor when this website is not allowed, with no technical detail", async () => {
    handler = () => ({ status: 403, json: { error: { code: "FORBIDDEN", message: "This website is not allowed to use this chat" } } });
    await chat();
    expect(root().textContent).toContain("We could not reach the team just now");
    expect(root().textContent).not.toContain("not allowed to use this chat");
  });

  it("starts a fresh session once when Chatwoot stops accepting the signature, then delivers the message", async () => {
    let first = true;
    handler = (c) => {
      if (c.method === "POST" && c.url.endsWith("/messages") && first) {
        first = false;
        return { status: 401, json: {} };
      }
      return defaultHandler(c);
    };
    await chat();
    expect(trail().filter((t) => t.endsWith("/api/public/chat/session"))).toHaveLength(2);
    expect(trail().filter((t) => t.endsWith("/messages"))).toHaveLength(2);
    expect(root().textContent).not.toContain("We could not reach the team");
  });

  it("shows a notice (not an answer) when a message cannot be sent", async () => {
    await chat();
    handler = (c) => (c.method === "POST" && c.url.endsWith("/messages") ? { status: 500, json: {} } : defaultHandler(c));
    typeAndSend("Second");
    await flush();
    expect(root().textContent).toContain("We could not reach the team just now");
  });
});

describe("spam trap and details", () => {
  it("shows a bot's message as sent but delivers nothing and never contacts any server", async () => {
    await chat({ name: "Bot", phone: "9800000000", trap: "http://spam.example" }, "buy cheap stuff");
    expect(calls).toHaveLength(0);
    expect(root().textContent).toContain("buy cheap stuff");
  });

  it("sends late details (ask-after mode) as a signed update of the same contact", async () => {
    load().init({ ...CONFIG, contact: { when: "after", defaultCountryCode: "+977" } });
    click(q(".launcher"));
    click(q(".start"));
    typeAndSend("Hi");
    await flush();
    // Chatwoot's answer arrives and the form appears after the first reply: simulate the counsellor's reply.
    outgoing = [{ id: 101, message_type: 1, content: "Hello!" }];
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(1000);
    calls.length = 0;
    fillForm({ name: "Sneha", phone: "9800000000", email: "s@example.com" });
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain(`/contacts/src-1`);
    expect(calls[0].body).toEqual({ identifier: "vis-1", identifier_hash: "hash-1", name: "Sneha", email: "s@example.com", phone_number: "+9779800000000" });
  });
});

describe("without a connection", () => {
  it("still uses the built-in scripted replies and sends nothing anywhere", async () => {
    load().init({ ...CONFIG, connection: null, contact: { when: "after" } });
    click(q(".launcher"));
    click(q(".start"));
    typeAndSend("Tell me about the UK");
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toHaveLength(0);
    expect(root().textContent).toContain("Good choice");
  });
});

// Guidance: a visitor is never left wondering what to do next.
describe("guidance for the visitor", () => {
  const TOPICS = ["Study in the UK", "Visa help"];
  const WITH_TOPICS = { ...CONFIG, topics: TOPICS };
  const text = () => root().textContent ?? "";
  // Count visible message bubbles only: the widget also keeps a hidden screen-reader line that repeats every team message.
  const count = (needle: string) => Array.from(root().querySelectorAll(".m")).filter((m) => m.textContent?.includes(needle)).length;
  const hint = () => q<HTMLTextAreaElement>("textarea")!.placeholder;
  const topicButtons = () => Array.from(root().querySelectorAll(".qr button")).map((b) => b.textContent);

  function openAndShareDetails(config: unknown, details = { name: "Sneha", phone: "9800000000" }) {
    load().init(config);
    click(q(".launcher"));
    click(q(".start"));
    fillForm(details);
  }

  it("right after the form, says what to do next with the visitor's name, offers the topics, and contacts nobody yet", async () => {
    openAndShareDetails(WITH_TOPICS);
    await flush();
    expect(text()).toContain("Thanks, Sneha! What would you like to know? Type your question below, and the team will reply right here.");
    expect(topicButtons()).toEqual(TOPICS);
    expect(hint()).toBe("Type your question here…");
    expect(calls).toHaveLength(0);
  });

  it("works without a name, with no stray comma", async () => {
    load().init({ ...WITH_TOPICS, contact: { when: "before", defaultCountryCode: "+977", name: { show: false } } });
    click(q(".launcher"));
    click(q(".start"));
    fillForm({ phone: "9800000000" });
    await flush();
    expect(text()).toContain("Thanks! What would you like to know?");
  });

  it("tapping a topic sends it as the first question", async () => {
    openAndShareDetails(WITH_TOPICS);
    await flush();
    click(root().querySelectorAll(".qr button")[0]);
    await flush();
    expect(trail().some((t) => t.endsWith("/messages"))).toBe(true);
    expect(calls.find((c) => c.url.endsWith("/messages"))!.body).toMatchObject({ content: "Study in the UK" });
  });

  it("after the first message really arrives, says so once, and the box goes back to its normal hint", async () => {
    await chat({ name: "Sneha", phone: "9800000000" });
    expect(count("Got it! The team will reply here as soon as possible.")).toBe(1);
    expect(hint()).toBe("Write a message…");
    typeAndSend("One more thing");
    await flush();
    expect(count("Got it! The team will reply here as soon as possible.")).toBe(1);
  });

  it("never says 'got it' when the message did not go through", async () => {
    handler = () => ({ status: 503, json: {} });
    await chat({ name: "Sneha", phone: "9800000000" });
    expect(text()).toContain("We could not reach the team just now");
    expect(text()).not.toContain("Got it!");
  });

  it("a visitor who asked first (typed or tapped before sharing details) is not asked again what they want", async () => {
    load().init(WITH_TOPICS);
    click(q(".launcher"));
    click(root().querySelectorAll(".chip")[0]); // "Study in the UK" from the home screen, held until the form is sent
    fillForm({ name: "Sneha", phone: "9800000000" });
    await flush();
    expect(text()).not.toContain("What would you like to know?");
    expect(calls.find((c) => c.url.endsWith("/messages"))!.body).toMatchObject({ content: "Study in the UK" });
    expect(count("Got it! The team will reply here as soon as possible.")).toBe(1);
  });

  it("the wording and the topics can be changed or switched off", async () => {
    openAndShareDetails({ ...WITH_TOPICS, guide: { afterDetails: "Hello{name}. Ask away.", topics: false, composerHint: "Ask here", afterSend: "" } });
    await flush();
    expect(text()).toContain("Hello, Sneha. Ask away.");
    expect(topicButtons()).toEqual([]);
    expect(hint()).toBe("Ask here");
    typeAndSend("Hi");
    await flush();
    expect(text()).not.toContain("Got it!");

    document.body.innerHTML = "";
    delete (window as unknown as { ZunkireeChat?: unknown }).ZunkireeChat;
    window.sessionStorage.clear();
    openAndShareDetails({ ...WITH_TOPICS, guide: { afterDetails: "" } });
    await flush();
    expect(text()).not.toContain("What would you like to know?");
  });

  it("stays quiet with the built-in demo (it answers by itself)", async () => {
    openAndShareDetails({ ...WITH_TOPICS, connection: null });
    await vi.advanceTimersByTimeAsync(3000);
    expect(text()).not.toContain("What would you like to know?");
    expect(text()).not.toContain("Got it!");
    expect(hint()).toBe("Write a message…");
  });

  it("stays quiet when the form comes after the first answer (the visitor already asked)", async () => {
    load().init({ ...WITH_TOPICS, contact: { when: "after", defaultCountryCode: "+977" } });
    click(q(".launcher"));
    click(q(".start"));
    typeAndSend("Hi");
    await flush();
    outgoing = [{ id: 101, message_type: 1, content: "Hello!" }];
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(1000);
    fillForm({ name: "Sneha", phone: "9800000000" });
    await flush();
    expect(text()).not.toContain("What would you like to know?");
  });

  it("gives a bot nothing", async () => {
    openAndShareDetails(WITH_TOPICS, { name: "Bot", phone: "9800000000", trap: "http://spam.example" } as never);
    await flush();
    expect(text()).not.toContain("What would you like to know?");
    expect(calls).toHaveLength(0);
  });

  it("does not repeat after a page reload", async () => {
    openAndShareDetails(WITH_TOPICS);
    await flush();
    expect(count("What would you like to know?")).toBe(1);
    vi.clearAllTimers();
    document.body.innerHTML = "";
    delete (window as unknown as { ZunkireeChat?: unknown }).ZunkireeChat;
    load().init(WITH_TOPICS);
    click(q(".launcher"));
    click(q(".start"));
    await flush();
    expect(count("What would you like to know?")).toBe(1);
  });
});

// Notification sound: a soft ding when a team reply arrives, with a mute button, never breaking the chat.
describe("notification sound", () => {
  // A stand-in for the browser's audio engine: it starts "suspended" like a real one until the visitor has clicked something.
  class FakeAudio {
    static instances: FakeAudio[] = [];
    state = "suspended";
    currentTime = 0;
    destination = {};
    started = 0;
    constructor() {
      FakeAudio.instances.push(this);
    }
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    createOscillator() {
      return { type: "", frequency: { value: 0 }, connect() {}, start: () => { this.started++; }, stop() {} };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
  }
  // One ding is two notes.
  const notes = () => FakeAudio.instances.reduce((n, a) => n + a.started, 0);
  const win = () => window as unknown as { AudioContext?: unknown };
  const text = () => root().textContent ?? "";
  const muteButton = () => q<HTMLButtonElement>('.bar button[aria-label="Mute notification sound"]');
  const unmuteButton = () => q<HTMLButtonElement>('.bar button[aria-label="Turn on notification sound"]');
  const reply = (id: number, content = "Hello from the team") => outgoing.push({ id, message_type: 1, content });

  beforeEach(() => {
    FakeAudio.instances = [];
    win().AudioContext = FakeAudio;
    window.localStorage.clear();
  });
  afterEach(() => {
    delete win().AudioContext;
    window.localStorage.clear();
  });

  it("dings once when a team reply arrives, after the visitor has clicked and sent something", async () => {
    await chat();
    expect(notes()).toBe(0); // the guidance lines and "got it" are not replies
    reply(101);
    await vi.advanceTimersByTimeAsync(5000);
    expect(text()).toContain("Hello from the team");
    expect(notes()).toBe(2);
  });

  it("is one ding for a burst of replies, and silent for the visitor's own messages and for errors", async () => {
    await chat();
    reply(101, "First");
    reply(102, "Second");
    reply(103, "Third");
    await vi.advanceTimersByTimeAsync(5000);
    expect(text()).toContain("Third");
    expect(notes()).toBe(2);

    const before = notes();
    handler = (c) => (c.method === "POST" && c.url.endsWith("/messages") ? { status: 500, json: {} } : defaultHandler(c));
    typeAndSend("Will this ding?");
    await flush();
    expect(text()).toContain("We could not reach the team just now");
    expect(notes()).toBe(before);
  });

  it("is blocked until the visitor has clicked something, as browsers require, and still shows the reply", async () => {
    await chat();
    vi.clearAllTimers();
    document.body.innerHTML = "";
    delete (window as unknown as { ZunkireeChat?: unknown }).ZunkireeChat;
    FakeAudio.instances = [];
    reply(101, "While you were away");
    load().init(CONFIG); // a reload: the saved conversation resumes, but nothing has been clicked yet
    await vi.advanceTimersByTimeAsync(5000);
    click(q(".launcher"));
    expect(text()).toContain("While you were away");
    expect(notes()).toBe(0);
  });

  it("has a mute button that silences the ding, switches back on, and is remembered", async () => {
    await chat();
    click(muteButton());
    expect(unmuteButton()).not.toBeNull();
    expect(unmuteButton()!.getAttribute("aria-pressed")).toBe("true");
    reply(101);
    await vi.advanceTimersByTimeAsync(5000);
    expect(text()).toContain("Hello from the team");
    expect(notes()).toBe(0);

    // The choice survives a reload.
    vi.clearAllTimers();
    document.body.innerHTML = "";
    delete (window as unknown as { ZunkireeChat?: unknown }).ZunkireeChat;
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    expect(unmuteButton()).not.toBeNull();

    click(unmuteButton());
    expect(muteButton()!.getAttribute("aria-pressed")).toBe("false");
    reply(102, "Second reply");
    await vi.advanceTimersByTimeAsync(5000);
    expect(notes()).toBe(2);
  });

  it("can be turned off completely: no button, and the audio engine is never even created", async () => {
    load().init({ ...CONFIG, sound: { enabled: false } });
    click(q(".launcher"));
    click(q(".start"));
    fillForm({ name: "Sneha", phone: "9800000000" });
    typeAndSend("Hi");
    await flush();
    reply(101);
    await vi.advanceTimersByTimeAsync(5000);
    expect(text()).toContain("Hello from the team");
    expect(muteButton()).toBeNull();
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("with no audio support in the browser there is no button and the chat works as before", async () => {
    delete win().AudioContext;
    await chat();
    reply(101);
    await vi.advanceTimersByTimeAsync(5000);
    expect(text()).toContain("Hello from the team");
    expect(muteButton()).toBeNull();
  });

  it("a broken audio engine never breaks the chat", async () => {
    win().AudioContext = class {
      constructor() {
        throw new Error("audio is not available");
      }
    };
    await chat();
    reply(101);
    await vi.advanceTimersByTimeAsync(5000);
    expect(text()).toContain("Hello from the team");
  });

  it("stays quiet with the built-in demo (no real conversation)", async () => {
    load().init({ ...CONFIG, connection: null, contact: { when: "after" } });
    click(q(".launcher"));
    click(q(".start"));
    typeAndSend("Tell me about the UK");
    await vi.advanceTimersByTimeAsync(3000);
    expect(text()).toContain("Good choice");
    expect(muteButton()).toBeNull();
    expect(FakeAudio.instances).toHaveLength(0);
  });
});
