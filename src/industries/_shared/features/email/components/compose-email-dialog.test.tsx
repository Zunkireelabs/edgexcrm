// @vitest-environment jsdom
//
// The lead-page "New email" pop-up. Before this change its "From" list held only the user's OWN connected
// Gmail accounts, so anyone without one (e.g. a counsellor) saw a greyed-out "Select inbox…" and could not
// send. It now also offers the tenant's verified company address, and says what to do when there is nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ComposeEmailDialog, replyFromAccountId } from "./compose-email-dialog";
import type { EmailThread } from "../hooks/use-email-threads";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The rich-text editor is irrelevant here — a textarea stands in for it.
vi.mock("./tiptap-editor", () => ({
  TipTapEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="body" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const GMAIL = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "manish@gmail.com",
  display_name: "Manish",
  provider: "gmail",
  created_at: "2026-01-01T00:00:00Z",
  health: "ok",
  last_synced_at: null,
  last_error: null,
};
const COMPANY = { email: "hello@mail.admizz.com", display_name: "Admizz Education" };

let inboxes: unknown[] = [];
let company: unknown = null;
let sendBodies: Record<string, unknown>[] = [];

beforeEach(() => {
  sendBodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (url.includes("/email/company-sender")) return { ok: true, json: async () => ({ data: company }) };
      if (url.includes("/email/inboxes")) return { ok: true, json: async () => ({ data: inboxes }) };
      if (url.includes("/email/send")) {
        sendBodies.push(JSON.parse(init!.body as string));
        return { ok: true, json: async () => ({ data: { thread_id: "t-new", email_id: "e-new" } }) };
      }
      return { ok: false, json: async () => ({}) };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDialog(props: Partial<React.ComponentProps<typeof ComposeEmailDialog>> = {}) {
  return render(
    <ComposeEmailDialog
      open
      onOpenChange={() => {}}
      defaultTo="art@gmail.com"
      leadId="lead-1"
      onSent={() => {}}
      {...props}
    />,
  );
}

async function fillAndSend() {
  fireEvent.change(screen.getByPlaceholderText("Subject"), { target: { value: "Hello" } });
  fireEvent.change(screen.getByTestId("body"), { target: { value: "<p>Hi</p>" } });
  const send = screen.getByRole("button", { name: "Send" });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send);
  await waitFor(() => expect(sendBodies).toHaveLength(1));
  return sendBodies[0];
}

describe("ComposeEmailDialog — the From list", () => {
  it("shows the company address when the user has no Gmail connected, and Send works from it (the reported bug)", async () => {
    inboxes = [];
    company = COMPANY;
    renderDialog();

    await waitFor(() => expect(screen.getByText("Admizz Education <hello@mail.admizz.com>")).toBeInTheDocument());
    expect(screen.queryByText(/No sending address yet/)).not.toBeInTheDocument();

    const body = await fillAndSend();
    expect(body.from_account_id).toBe("company");
    expect(body.lead_id).toBe("lead-1");
  });

  it("keeps the user's own Gmail as the default when they have one AND the company address exists", async () => {
    inboxes = [GMAIL];
    company = COMPANY;
    renderDialog();

    await waitFor(() => expect(screen.getByText("Manish <manish@gmail.com>")).toBeInTheDocument());
    const body = await fillAndSend();
    expect(body.from_account_id).toBe(GMAIL.id); // Gmail path unchanged
  });

  it("defaults to the user's Gmail even when the company-sender request finishes FIRST (the two requests race)", async () => {
    inboxes = [GMAIL];
    company = COMPANY;
    let releaseInboxes: () => void = () => {};
    const inboxesGate = new Promise<void>((r) => (releaseInboxes = r));
    const baseFetch = globalThis.fetch as unknown as (u: string, i?: { body?: string }) => Promise<unknown>;
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      if (url.includes("/email/inboxes")) await inboxesGate; // Gmail list is slow
      return baseFetch(url, init);
    });
    renderDialog();

    // the company list has arrived, the Gmail list has not: nothing must be chosen yet
    await new Promise((r) => setTimeout(r, 20));
    releaseInboxes();

    await waitFor(() => expect(screen.getByText("Manish <manish@gmail.com>")).toBeInTheDocument());
    const body = await fillAndSend();
    expect(body.from_account_id).toBe(GMAIL.id);
  });

  it("with only a Gmail inbox (no company sender) behaves exactly as before", async () => {
    inboxes = [GMAIL];
    company = null;
    renderDialog();

    await waitFor(() => expect(screen.getByText("Manish <manish@gmail.com>")).toBeInTheDocument());
    const body = await fillAndSend();
    expect(body.from_account_id).toBe(GMAIL.id);
  });

  it("with nothing to send from, says so and how to fix it instead of a dead greyed-out box; Send stays disabled", async () => {
    inboxes = [];
    company = null;
    renderDialog();

    await waitFor(() => expect(screen.getByText(/No sending address yet/)).toBeInTheDocument());
    expect(screen.getByText(/Connect your Gmail in Settings → Communications/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Subject"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByTestId("body"), { target: { value: "<p>Hi</p>" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("does not flash the 'no sending address' message while the lists are still loading", () => {
    inboxes = [];
    company = null;
    renderDialog();
    // first paint, before either request resolved
    expect(screen.queryByText(/No sending address yet/)).not.toBeInTheDocument();
  });
});

const COMPANY_THREAD: EmailThread = {
  id: "thread-co",
  connected_email_account_id: null,
  gmail_thread_id: "",
  lead_id: "lead-1",
  contact_id: null,
  subject: "Hello",
  last_message_at: "2026-11-24T10:00:00Z",
  message_count: 2,
  created_at: "2026-11-24T09:00:00Z",
  updated_at: "2026-11-24T10:00:00Z",
  emails: [
    {
      id: "e1",
      direction: "outbound",
      provider: "resend",
      from_email: "hello@mail.admizz.com",
      from_name: "Admizz Education",
      to_emails: ["art@gmail.com"],
      cc_emails: [],
      subject: "Hello",
      body_html: "<p>Hi</p>",
      sent_at: "2026-11-24T09:00:00Z",
      received_at: null,
      read_at: null,
      sender_user_id: "u1",
      in_reply_to: null,
      rfc_references: [],
      rfc_message_id: null,
      gmail_message_id: "",
    },
    {
      id: "e2",
      direction: "inbound",
      provider: "edgex_native",
      from_email: "art@gmail.com",
      from_name: "Art Dutta",
      to_emails: ["reply+x@edgex.zunkireelabs.com"],
      cc_emails: [],
      subject: "Re: Hello",
      body_html: "<p>Thanks</p>",
      sent_at: null,
      received_at: "2026-11-24T10:00:00Z",
      read_at: null,
      sender_user_id: null,
      in_reply_to: null,
      rfc_references: [],
      rfc_message_id: "<lead-reply@gmail.com>",
      gmail_message_id: "",
    },
  ],
};

describe("replyFromAccountId", () => {
  it("uses the thread's Gmail account when it has one", () => {
    expect(replyFromAccountId({ ...COMPANY_THREAD, connected_email_account_id: "acct-1" })).toBe("acct-1");
  });
  it("uses the company sender for a thread the company address started", () => {
    expect(replyFromAccountId(COMPANY_THREAD)).toBe("company");
  });
  it("has NO valid sender for any other no-account thread (e.g. a personal BCC thread) — Send stays disabled as before", () => {
    const bcc = { ...COMPANY_THREAD, emails: COMPANY_THREAD.emails.map((e) => ({ ...e, provider: "edgex_native" })) };
    expect(replyFromAccountId(bcc)).toBe("");
    expect(replyFromAccountId({ ...COMPANY_THREAD, emails: [] })).toBe("");
  });
});

describe("ComposeEmailDialog — replying on a company thread", () => {
  it("replies from the company address, on the same thread, with the threading context", async () => {
    inboxes = [];
    company = COMPANY;
    renderDialog({
      replyContext: { thread: COMPANY_THREAD, lastMessage: COMPANY_THREAD.emails[1] },
    });

    await waitFor(() => expect(screen.getByText("Admizz Education <hello@mail.admizz.com>")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("body"), { target: { value: "<p>Sure!</p>" } });
    const send = screen.getByRole("button", { name: "Send" });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    await waitFor(() => expect(sendBodies).toHaveLength(1));

    expect(sendBodies[0]).toMatchObject({
      from_account_id: "company",
      to: ["art@gmail.com"],
      subject: "Re: Hello",
      reply_context: { thread_id: "thread-co", in_reply_to: "<lead-reply@gmail.com>" },
    });
  });

  it("cannot send a reply on a company thread if the company address is no longer available", async () => {
    inboxes = [];
    company = null;
    renderDialog({
      replyContext: { thread: COMPANY_THREAD, lastMessage: COMPANY_THREAD.emails[1] },
    });
    fireEvent.change(screen.getByTestId("body"), { target: { value: "<p>Sure!</p>" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeDisabled());
  });
});
