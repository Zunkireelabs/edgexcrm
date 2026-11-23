// @vitest-environment jsdom

// Runs the real public/chat-widget/chat-widget.js in a simulated browser and drives it like a visitor.
// The widget keeps its screens inside a shadow root, so these tests reach in through host.shadowRoot.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const SOURCE = readFileSync(path.join(process.cwd(), "public/chat-widget/chat-widget.js"), "utf8");

type Chat = { init: (config?: unknown) => unknown; version: string };

function load(): Chat {
  new Function(SOURCE).call(window);
  return (window as unknown as { ZunkireeChat: Chat }).ZunkireeChat;
}

const root = () => document.getElementById("zk-chat-host")!.shadowRoot!;
const q = <T extends Element>(sel: string) => root().querySelector(sel) as T | null;
const qa = (sel: string) => Array.from(root().querySelectorAll(sel));
const click = (el: Element | null) => (el as HTMLElement).click();
const byText = (sel: string, text: string) => qa(sel).find((e) => e.textContent?.includes(text)) as HTMLElement | undefined;

const CONFIG = {
  brand: { name: "Admizz Education", logo: "/logo-dark.webp" },
  greeting: "Hi there, how can we help you study abroad?",
  topics: ["Study in the UK", "Visa help"],
  link: { label: "Book a free consultation", sub: "Pick a time", url: "/register" },
  agent: { name: "Admizz counsellors", initials: "AE" },
};

function type(text: string) {
  const ta = q<HTMLTextAreaElement>("textarea")!;
  ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  document.body.innerHTML = "";
  delete (window as unknown as { ZunkireeChat?: unknown }).ZunkireeChat;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks(); // for example the blocked-storage test must not leak into the next ones
});

describe("loading", () => {
  it("adds one launcher and keeps the panel closed until it is clicked", () => {
    load().init(CONFIG);
    expect(document.querySelectorAll("#zk-chat-host")).toHaveLength(1);
    expect(q(".zk")!.classList.contains("open")).toBe(false);
    expect(q(".launcher")!.getAttribute("aria-expanded")).toBe("false");
    click(q(".launcher"));
    expect(q(".zk")!.classList.contains("open")).toBe(true);
    expect(q(".launcher")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not add a second widget when init runs twice", () => {
    const chat = load();
    chat.init(CONFIG);
    chat.init(CONFIG);
    expect(document.querySelectorAll("#zk-chat-host")).toHaveLength(1);
  });

  it("keeps its styles in the shadow root, not in the page", () => {
    load().init(CONFIG);
    expect(document.head.querySelectorAll("style")).toHaveLength(0);
    expect(root().querySelector("style")).not.toBeNull();
  });
});

describe("home screen", () => {
  it("shows the brand, greeting, team status, topics and the highlighted link", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    expect(q(".hero img")!.getAttribute("src")).toBe("/logo-dark.webp");
    expect(q(".hero h2")!.textContent).toBe("Hi there, how can we help you study abroad?");
    expect(qa(".chip").map((c) => c.textContent)).toEqual(["Study in the UK", "Visa help"]);
    expect(q<HTMLAnchorElement>(".linkrow")!.getAttribute("href")).toBe("/register");
    expect(q(".linkrow")!.getAttribute("rel")).toBe("noopener");
  });

  it("says the team is away when it is not online", () => {
    load().init({ ...CONFIG, online: false });
    click(q(".launcher"));
    expect(q(".team small")!.textContent).toContain("Our team is away");
    expect(q(".dot")!.classList.contains("off")).toBe(true);
  });

  it("shows the brand name when there is no logo", () => {
    load().init({ brand: { name: "Acme" } });
    click(q(".launcher"));
    expect(q(".hero img")).toBeNull();
    expect(q(".hero .name")!.textContent).toBe("Acme");
  });
});

describe("conversation", () => {
  it("opens from 'Start a conversation' with a welcome message and a disabled send button", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    expect(q(".bar b")!.textContent).toBe("Admizz counsellors");
    expect(q(".m.a")!.textContent).toContain("Admizz Education");
    expect(q<HTMLButtonElement>(".send")!.disabled).toBe(true);
    type("Hello");
    expect(q<HTMLButtonElement>(".send")!.disabled).toBe(false);
  });

  it("sends a message, shows typing, then the scripted reply with quick replies", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    type("I want to study in the UK");
    click(q(".send"));

    expect(qa(".m.v").map((m) => m.textContent)).toEqual(["I want to study in the UK"]);
    vi.advanceTimersByTime(500);
    expect(q(".typing")).not.toBeNull();
    vi.advanceTimersByTime(1500);
    expect(q(".typing")).toBeNull();
    expect(qa(".m.a").pop()!.textContent).toContain("Which course");
    expect(qa(".qr button").map((b) => b.textContent)).toEqual(["September intake", "January intake", "Not sure yet"]);
  });

  it("a topic chip opens the chat and sends that topic", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    click(byText(".chip", "Visa help") ?? null);
    expect(q(".bar")).not.toBeNull();
    expect(qa(".m.v").map((m) => m.textContent)).toEqual(["Visa help"]);
  });

  it("a quick reply sends its text", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    type("uk");
    click(q(".send"));
    vi.advanceTimersByTime(2000);
    click(byText(".qr button", "September intake") ?? null);
    expect(qa(".m.v").pop()!.textContent).toBe("September intake");
  });

  it("sends with Enter but not Shift+Enter", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    type("first");
    q("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    expect(qa(".m.v")).toHaveLength(0);
    q("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(qa(".m.v").map((m) => m.textContent)).toEqual(["first"]);
  });

  it("ignores an empty or blank message", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    type("   ");
    q("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(qa(".m.v")).toHaveLength(0);
  });

  it("shows what a visitor types as plain text, never as HTML", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    type('<img src=x onerror="window.__pwned=1"><b>bold</b>');
    click(q(".send"));
    const bubble = qa(".m.v").pop()!;
    expect(bubble.textContent).toBe('<img src=x onerror="window.__pwned=1"><b>bold</b>');
    expect(bubble.querySelector("img, b")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe("contact details", () => {
  function reachDetailsCard() {
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    type("uk");
    click(q(".send"));
    vi.advanceTimersByTime(2000 + 800);
  }

  it("asks for the name and WhatsApp number once, after the first answer", () => {
    reachDetailsCard();
    expect(qa(".card form")).toHaveLength(1);
    expect(q<HTMLInputElement>('input[aria-label="Your name"]')).not.toBeNull();
    expect(q<HTMLInputElement>('input[aria-label="WhatsApp number"]')).not.toBeNull();
  });

  it("refuses an empty form with a clear message", () => {
    reachDetailsCard();
    q<HTMLFormElement>(".card form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(q(".card .err")!.textContent).toContain("valid WhatsApp number");
  });

  it("accepts valid details, thanks the visitor by name, and does not ask again", () => {
    reachDetailsCard();
    q<HTMLInputElement>('input[aria-label="Your name"]')!.value = "Sneha";
    q<HTMLInputElement>('input[aria-label="WhatsApp number"]')!.value = "+977 9800000000";
    q<HTMLFormElement>(".card form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    expect(root().textContent).toContain("Details shared. Thank you, Sneha.");
    vi.advanceTimersByTime(2000);
    expect(qa(".m.a").pop()!.textContent).toContain("Thanks, Sneha");
    expect(qa(".card form")).toHaveLength(0);
  });
});

describe("messages tab, closing and memory", () => {
  it("shows an empty state, then the latest message once there is a conversation", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    click(byText(".nav button", "Messages") ?? null);
    expect(q(".empty b")!.textContent).toBe("No messages yet");

    click(q(".empty .btn"));
    type("hello there");
    click(q(".send"));
    click(q(".iconbtn")); // back
    click(byText(".nav button", "Messages") ?? null);
    expect(q(".convo small")!.textContent).toBe("You: hello there");
  });

  it("closes with Escape and returns focus handling to the launcher", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    q(".zk")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(q(".zk")!.classList.contains("open")).toBe(false);
    expect(q(".launcher")!.getAttribute("aria-label")).toBe("Open chat");
  });

  it("remembers the conversation after a page reload (same tab)", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    type("remember me");
    click(q(".send"));

    document.body.innerHTML = "";
    delete (window as unknown as { ZunkireeChat?: unknown }).ZunkireeChat;
    load().init(CONFIG);
    click(q(".launcher"));
    click(byText(".nav button", "Messages") ?? null);
    expect(q(".convo small")!.textContent).toContain("remember me");
  });

  it("still works when browser storage is blocked", () => {
    const original = window.sessionStorage.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    type("hi");
    expect(() => click(q(".send"))).not.toThrow();
    expect(qa(".m.v")).toHaveLength(1);
    window.sessionStorage.setItem = original;
  });
});

describe("contact form before chatting (ask-before mode)", () => {
  const BEFORE = { ...CONFIG, contact: { when: "before" } };

  function fill(v: { name?: string; phone?: string; email?: string }) {
    const set = (label: string, value?: string) => {
      const input = q<HTMLInputElement>(`input[aria-label="${label}"]`);
      if (input && value !== undefined) input.value = value;
    };
    set("Your name", v.name);
    set("WhatsApp number", v.phone);
    set("Email", v.email);
  }
  const submit = () => q<HTMLFormElement>(".card form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

  it("shows name, WhatsApp number and email as soon as 'Start a conversation' is clicked, email marked optional", () => {
    load().init(BEFORE);
    click(q(".launcher"));
    click(q(".start"));
    // The hidden spam-trap input (name="website") is not a field the visitor sees.
    expect(qa('.card input:not([name="website"])').map((i) => i.getAttribute("aria-label"))).toEqual(["Your name", "WhatsApp number", "Email"]);
    expect(qa(".card label").map((l) => l.textContent)).toEqual(["Your name", "WhatsApp number", "Email (optional)"]);
    expect(q(".card p")!.textContent).toContain("how can we reach you");
  });

  it("puts the cursor in the first field and keeps the message box waiting", () => {
    load().init(BEFORE);
    click(q(".launcher"));
    click(q(".start"));
    expect(root().activeElement).toBe(q('input[aria-label="Your name"]'));
    expect(q<HTMLTextAreaElement>("textarea")!.disabled).toBe(true);
    expect(q<HTMLTextAreaElement>("textarea")!.placeholder).toBe("Share your details to start");
    expect(q<HTMLButtonElement>(".send")!.disabled).toBe(true);
  });

  it("holds a topic message until the details are shared, then sends it once", () => {
    load().init(BEFORE);
    click(q(".launcher"));
    click(byText(".chip", "Visa help") ?? null);

    expect(qa(".m.v")).toHaveLength(0); // nothing sent yet
    expect(q(".card .hold")!.textContent).toContain("send your message");

    fill({ name: "Sneha", phone: "+977 9800000000" });
    submit();

    expect(qa(".m.v").map((m) => m.textContent)).toEqual(["Visa help"]);
    vi.advanceTimersByTime(2000);
    expect(qa(".m.a").pop()!.textContent).toContain("Which country");
    expect(root().textContent).toContain("Details shared. Thank you, Sneha.");
    expect(q<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
  });

  it("holds a typed message too, and does not ask again for the next one", () => {
    load().init({ ...BEFORE, contact: { when: "before", name: { show: false }, email: { show: false } } });
    click(q(".launcher"));
    click(q(".start"));
    expect(qa('.card input:not([name="website"])')).toHaveLength(1); // only the WhatsApp number is left
    fill({ phone: "9800000000" });
    submit();
    type("second question");
    click(q(".send"));
    expect(qa(".m.v").map((m) => m.textContent)).toEqual(["second question"]);
    expect(qa(".card form")).toHaveLength(0);
  });

  it("names every missing required field, in plain words", () => {
    load().init(BEFORE);
    click(q(".launcher"));
    click(q(".start"));
    submit();
    expect(q(".card .err")!.textContent).toBe("Please add your name and a valid WhatsApp number.");
    expect(q(".m.v")).toBeNull();
  });

  it("rejects an email that is not an email, and a phone that is too short", () => {
    load().init(BEFORE);
    click(q(".launcher"));
    click(q(".start"));
    fill({ name: "Sneha", phone: "123", email: "not-an-email" });
    submit();
    expect(q(".card .err")!.textContent).toBe("Please add a valid WhatsApp number and a valid email.");
  });

  it("accepts name and phone with no email (email is optional)", () => {
    load().init(BEFORE);
    click(q(".launcher"));
    click(q(".start"));
    fill({ name: "Sneha", phone: "9800000000" });
    submit();
    expect(root().textContent).toContain("Details shared");
    expect(q(".card .err")).toBeNull();
  });

  it("makes the email required when configured", () => {
    load().init({ ...CONFIG, contact: { when: "before", email: { show: true, required: true } } });
    click(q(".launcher"));
    click(q(".start"));
    expect(qa(".card label").map((l) => l.textContent)).toEqual(["Your name", "WhatsApp number", "Email"]);
    fill({ name: "Sneha", phone: "9800000000" });
    submit();
    expect(q(".card .err")!.textContent).toBe("Please add your email.");
  });

  it("needs a way to reach the visitor when both phone and email are optional", () => {
    load().init({ ...CONFIG, contact: { when: "before", phone: { show: true, required: false } } });
    click(q(".launcher"));
    click(q(".start"));
    fill({ name: "Sneha" });
    submit();
    expect(q(".card .err")!.textContent).toBe("Please add a WhatsApp number or an email so we can reach you.");
    fill({ email: "sneha@example.com" });
    submit();
    expect(root().textContent).toContain("Details shared");
  });

  it("does not ask again after a page reload in the same tab", () => {
    load().init(BEFORE);
    click(q(".launcher"));
    click(q(".start"));
    fill({ name: "Sneha", phone: "9800000000", email: "sneha@example.com" });
    submit();

    document.body.innerHTML = "";
    delete (window as unknown as { ZunkireeChat?: unknown }).ZunkireeChat;
    load().init(BEFORE);
    click(q(".launcher"));
    click(q(".start"));
    expect(qa(".card form")).toHaveLength(0);
    expect(q<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
  });

  it("in the default (ask-after) mode the first message goes straight out and the form comes later", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    expect(qa(".card form")).toHaveLength(0);
    expect(q<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
    type("hello");
    click(q(".send"));
    expect(qa(".m.v")).toHaveLength(1);
    vi.advanceTimersByTime(2000 + 800);
    expect(qa(".card form")).toHaveLength(1);
    expect(q('input[aria-label="Email"]')).not.toBeNull();
  });
});

describe("start card", () => {
  it("keeps the arrow in the accent colour: the subtitle rule must not catch it", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    const css = q("style")!.textContent!;
    expect(css).toContain(".start .sub{");
    expect(css).not.toMatch(/\.start span\{/);
    expect(q(".start .sub")!.textContent).toBe("Ask us anything");
    expect(q(".start .arrow")).not.toBeNull();
  });
});

describe("hiding", () => {
  it("setHidden hides and shows the whole widget, and is safe before init", () => {
    const chat = load() as Chat & { setHidden: (hidden: boolean) => void };
    expect(() => chat.setHidden(true)).not.toThrow();
    chat.init(CONFIG);
    chat.setHidden(true);
    expect(document.getElementById("zk-chat-host")!.style.display).toBe("none");
    chat.setHidden(false);
    expect(document.getElementById("zk-chat-host")!.style.display).toBe("");
  });
});

describe("accessibility basics", () => {
  it("labels the launcher, panel, message box and the log", () => {
    load().init(CONFIG);
    click(q(".launcher"));
    click(q(".start"));
    expect(q(".launcher")!.getAttribute("aria-label")).toBe("Close chat");
    expect(q(".panel")!.getAttribute("role")).toBe("dialog");
    expect(q(".panel")!.getAttribute("aria-label")).toBe("Chat with Admizz Education");
    expect(q("textarea")!.getAttribute("aria-label")).toBe("Message");
    expect(q(".msgs")!.getAttribute("role")).toBe("log");
    expect(q("[aria-live]")).not.toBeNull();
  });
});
