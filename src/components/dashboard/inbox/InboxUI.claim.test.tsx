// @vitest-environment jsdom
//
// The whole Inbox screen, with the network faked: open a website chat nobody has accepted, press Accept, and watch the
// screen flip to "yours". Then hand it over, and watch it lock. The fake server follows the same rules as the real routes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("conversation=conv-1"),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/inbox",
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const ch = { on: () => ch, subscribe: () => ch };
    return { channel: () => ch, removeChannel: () => {} };
  },
}));

import { InboxUI } from "./InboxUI";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let conv: Row;
let messages: Row[];
let calls: { url: string; method: string; body?: Row }[];
let claimResult: { status: number; message?: string };

const MEMBERS = [
  { user_id: "me", name: "Manish Sah" },
  { user_id: "bijay", name: "Bijay Dahal" },
];

function json(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => (status < 400 ? { data } : { error: { message: (data as Row).message } }) };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  toast.success.mockClear();
  toast.error.mockClear();
  calls = [];
  claimResult = { status: 200 };
  messages = [{ id: "m1", direction: "inbound", author_type: "customer", content_text: "Hi, I want to study in the UK", attachments: [], status: "received", created_at: "2026-11-24T10:00:00Z" }];
  conv = {
    id: "conv-1", provider: "chatwoot", channel_id: "ch1", external_contact_id: "x", contact_display_name: "Ram Sharma",
    last_message_preview: "Hi", last_message_at: "2026-11-24T10:00:00Z", unread_count: 1, status: "open",
    assignee_type: "unassigned", assigned_to_user_id: null, lead_id: null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(init.body) as Row) : undefined;
      calls.push({ url, method, body });
      if (url.includes("/handover-targets")) return json(MEMBERS);
      if (url.includes("/claim") && method === "POST") {
        if (claimResult.status === 200) {
          conv = { ...conv, assignee_type: "human", assigned_to_user_id: "me" };
          messages = [...messages, { id: "n1", direction: "outbound", author_type: "system", content_text: "Manish accepted this chat", attachments: [], status: "sent", created_at: "2026-11-24T10:01:00Z" }];
          return json({ owner_id: "me" });
        }
        return json({ message: claimResult.message }, claimResult.status);
      }
      if (url.includes("/handover") && method === "POST") {
        conv = { ...conv, assigned_to_user_id: body!.to_user_id as string };
        return json({ owner_id: body!.to_user_id });
      }
      if (url.includes("/messages")) return json(messages);
      if (url.includes("/api/v1/inbox/conversations")) return json([conv]);
      return json([]);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (role = "staff") =>
  render(<InboxUI tenantId="t" userId="me" userRole={role} initialChannels={[]} initialConversations={[conv]} />);
const post = (frag: string) => calls.filter((c) => c.method === "POST" && c.url.includes(frag));

describe("Inbox: a website chat nobody has accepted", () => {
  it("opens with Accept instead of a reply box", async () => {
    show();
    expect(await screen.findByRole("button", { name: /Accept this chat/ })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Type a message/)).toBeNull();
  });

  it("Accept calls the claim route once, then the screen flips to 'yours' with the reply box and the grey note", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Accept this chat/ }));
    expect(await screen.findByPlaceholderText(/Type a message/)).toBeInTheDocument();
    expect(post("/claim")).toHaveLength(1);
    expect(post("/claim")[0].url).toContain("/api/v1/inbox/conversations/conv-1/claim");
    expect(screen.getAllByText("You're handling").length).toBeGreaterThan(0);
    expect(screen.getByText("Manish accepted this chat")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("You're handling this chat");
  });

  it("if someone was faster, shows who (their name from the server) and stays locked", async () => {
    claimResult = { status: 409, message: "Bijay is already handling this chat." };
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Accept this chat/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Bijay is already handling this chat."));
    expect(screen.queryByPlaceholderText(/Type a message/)).toBeNull();
  });
});

describe("Inbox: handing a chat over", () => {
  const accepted = () => {
    conv = { ...conv, assignee_type: "human", assigned_to_user_id: "me" };
  };

  it("the owner opens Hand over, picks a teammate, and the chat locks for them afterwards", async () => {
    accepted();
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Hand over" }));
    fireEvent.change(await screen.findByLabelText("Hand over to"), { target: { value: "bijay" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Hand over" }).pop()!);

    await waitFor(() => expect(post("/handover")).toHaveLength(1));
    expect(post("/handover")[0].body).toEqual({ to_user_id: "bijay" });
    expect(toast.success).toHaveBeenCalledWith("Chat handed to Bijay Dahal");
    // now Bijay's: locked for me, and named
    expect(await screen.findByText("Bijay Dahal is handling this chat.")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Type a message/)).toBeNull();
  });

  it("an admin viewing someone else's chat can Take over, which hands it to themselves", async () => {
    conv = { ...conv, assignee_type: "human", assigned_to_user_id: "bijay" };
    show("admin");
    fireEvent.click(await screen.findByRole("button", { name: "Take over" }));
    await waitFor(() => expect(post("/handover")).toHaveLength(1));
    expect(post("/handover")[0].body).toEqual({ to_user_id: "me" });
    expect(toast.success).toHaveBeenCalledWith("You took over this chat");
  });

  it("a non-admin viewing someone else's chat sees the lock and no Take over", async () => {
    conv = { ...conv, assignee_type: "human", assigned_to_user_id: "bijay" };
    show("staff");
    expect(await screen.findByText("Bijay Dahal is handling this chat.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take over" })).toBeNull();
  });
});

describe("Inbox: other channels are unchanged", () => {
  it("a WhatsApp conversation keeps its reply box and never calls the claim routes", async () => {
    conv = { ...conv, provider: "whatsapp" };
    show();
    expect(await screen.findByPlaceholderText(/Type a message/)).toBeInTheDocument();
    expect(post("/claim")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Accept this chat/ })).toBeNull();
  });
});

describe("Inbox: only the person handling a website chat can turn it into a lead", () => {
  it("someone else's chat: no Convert to lead, with the reason", async () => {
    conv = { ...conv, assignee_type: "human", assigned_to_user_id: "bijay" };
    const { container } = show("staff");
    await screen.findByText("Bijay Dahal is handling this chat.");
    expect(screen.queryByRole("button", { name: /Convert to lead/ })).toBeNull();
    expect(container.querySelector("[data-accept-first]")).not.toBeNull();
  });
  it("my own chat: Convert to lead is there", async () => {
    conv = { ...conv, assignee_type: "human", assigned_to_user_id: "me" };
    show("staff");
    expect(await screen.findByRole("button", { name: /Convert to lead/ })).toBeInTheDocument();
  });
  it("an admin can convert a chat someone else is handling", async () => {
    conv = { ...conv, assignee_type: "human", assigned_to_user_id: "bijay" };
    show("admin");
    expect(await screen.findByRole("button", { name: /Convert to lead/ })).toBeInTheDocument();
  });
  it("a chat nobody has accepted yet: accept first, so no Convert for a normal teammate", async () => {
    show("staff");
    await screen.findByRole("button", { name: /Accept this chat/ });
    expect(screen.queryByRole("button", { name: /Convert to lead/ })).toBeNull();
  });
});
