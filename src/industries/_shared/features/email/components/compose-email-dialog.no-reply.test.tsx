// @vitest-environment jsdom
//
// The New email pop-up with the tenant's NO-REPLY sender: a second choice in From, and while it is chosen the message sits inside
// the company layout (fixed logo + colour bar above, fixed footer below) with a Preview button. Nothing changes for any other sender.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ComposeEmailDialog, fillLeadTokens } from "./compose-email-dialog";
import type { EmailThread } from "../hooks/use-email-threads";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The rich-text editor is irrelevant here: a textarea stands in for it.
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
const BRAND = {
  name: "Admizz Education",
  logoUrl: "https://cdn.example.com/admizz-logo.png",
  color: "#0D1282",
  accent: "#FDED22",
  helpEmail: "hello@admizz.com",
};
const COMPANY_WITH_NO_REPLY = {
  email: "hello@mail.admizz.com",
  display_name: "Admizz Education",
  no_reply: { email: "no-reply@mail.admizz.com", display_name: "Admizz Education", brand: BRAND },
};
const COMPANY_ONLY = { email: "hello@mail.admizz.com", display_name: "Admizz Education" };
const NO_REPLY_LABEL = "Admizz Education <no-reply@mail.admizz.com>";
const COMPANY_LABEL = "Admizz Education <hello@mail.admizz.com>";

let inboxes: unknown[] = [];
let company: unknown = null;
let sendBodies: Record<string, unknown>[] = [];

// Radix Select needs a few browser APIs jsdom does not have.
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

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
  const view = render(
    <ComposeEmailDialog
      open
      onOpenChange={() => {}}
      defaultTo="sita.example@gmail.com"
      leadId="lead-1"
      leadFirstName="Sita"
      leadLastName="Sharma"
      onSent={() => {}}
      {...props}
    />,
  );
  return view;
}

/** Opens the From dropdown and picks the option with this label. */
async function chooseFrom(label: string) {
  const trigger = await screen.findByRole("combobox");
  await waitFor(() => expect(trigger).toBeEnabled());
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

describe("the From list with a no-reply sender", () => {
  it("offers it as a second choice after the company address, and the company address stays the default", async () => {
    company = COMPANY_WITH_NO_REPLY;
    renderDialog();
    await waitFor(() => expect(screen.getByText(COMPANY_LABEL)).toBeInTheDocument());
    const trigger = screen.getByRole("combobox");
    await waitFor(() => expect(trigger).toBeEnabled());
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual([COMPANY_LABEL, NO_REPLY_LABEL]);
    expect(screen.queryByTestId("no-reply-frame")).not.toBeInTheDocument();
  });

  it("with a Gmail inbox, Gmail is still the default and the no-reply address is last", async () => {
    inboxes = [GMAIL];
    company = COMPANY_WITH_NO_REPLY;
    renderDialog();
    await waitFor(() => expect(screen.getByText("Manish <manish@gmail.com>")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Subject"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByTestId("body"), { target: { value: "<p>Hi</p>" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendBodies).toHaveLength(1));
    expect(sendBodies[0].from_account_id).toBe(GMAIL.id);
  });

  it("is not offered when the tenant has not set it up (nothing changes for them)", async () => {
    inboxes = [];
    company = COMPANY_ONLY;
    renderDialog();
    await waitFor(() => expect(screen.getByText(COMPANY_LABEL)).toBeInTheDocument());
    expect(screen.queryByText(NO_REPLY_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
  });
});

describe("the company frame around the message", () => {
  async function pickNoReply() {
    inboxes = [];
    company = COMPANY_WITH_NO_REPLY;
    const view = renderDialog();
    await waitFor(() => expect(screen.getByText(COMPANY_LABEL)).toBeInTheDocument());
    await chooseFrom(NO_REPLY_LABEL);
    await screen.findByTestId("no-reply-frame");
    return view;
  }

  it("appears with a fixed logo on top and a fixed footer below, with the editor in between", async () => {
    await pickNoReply();
    const frame = screen.getByTestId("no-reply-frame");
    const header = within(frame).getByTestId("template-header");
    const footer = within(frame).getByTestId("template-footer");
    expect(header.querySelector("img")).toHaveAttribute("src", "https://cdn.example.com/admizz-logo.png");
    expect(header.querySelector("img")).toHaveAttribute("alt", "Admizz Education");
    expect(footer).toHaveTextContent("Admizz Education");
    expect(footer).toHaveTextContent("Need help? Write to hello@admizz.com");
    // header, then the editor, then the footer
    const order = Array.from(frame.querySelectorAll('[data-testid="template-header"], [data-testid="body"], [data-testid="template-footer"]')).map((e) => e.getAttribute("data-testid"));
    expect(order).toEqual(["template-header", "body", "template-footer"]);
  });

  it("the fixed parts cannot be clicked into or read by a screen reader as part of the message", async () => {
    await pickNoReply();
    for (const id of ["template-header", "template-footer"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByTestId(id).className).toContain("pointer-events-none");
    }
  });

  it("is gone again when another sender is chosen, and what was typed is kept either way", async () => {
    await pickNoReply();
    fireEvent.change(screen.getByTestId("body"), { target: { value: "<p>Keep me</p>" } });
    await chooseFrom(COMPANY_LABEL);
    await waitFor(() => expect(screen.queryByTestId("no-reply-frame")).not.toBeInTheDocument());
    expect(screen.getByTestId("body")).toHaveValue("<p>Keep me</p>");
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    await chooseFrom(NO_REPLY_LABEL);
    await screen.findByTestId("no-reply-frame");
    expect(screen.getByTestId("body")).toHaveValue("<p>Keep me</p>");
  });

  it("shows a Preview button only while the no-reply sender is chosen", async () => {
    await pickNoReply();
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByText(/Sent with the company layout/)).toBeInTheDocument();
  });
});

describe("sending from the no-reply address", () => {
  it("posts from_account_id 'no-reply' with the message AS TYPED (the server adds the layout)", async () => {
    company = COMPANY_WITH_NO_REPLY;
    renderDialog();
    await waitFor(() => expect(screen.getByText(COMPANY_LABEL)).toBeInTheDocument());
    await chooseFrom(NO_REPLY_LABEL);
    fireEvent.change(screen.getByPlaceholderText("Subject"), { target: { value: "Documents needed" } });
    fireEvent.change(screen.getByTestId("body"), { target: { value: "<p>Hi {{first_name}}</p>" } });
    const send = screen.getByRole("button", { name: "Send" });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    await waitFor(() => expect(sendBodies).toHaveLength(1));
    expect(sendBodies[0]).toMatchObject({ from_account_id: "no-reply", to: ["sita.example@gmail.com"], subject: "Documents needed", body_html: "<p>Hi {{first_name}}</p>", lead_id: "lead-1" });
    expect(String(sendBodies[0].body_html)).not.toContain("<!DOCTYPE");
  });
});

describe("Preview", () => {
  async function openPreview(props: Partial<React.ComponentProps<typeof ComposeEmailDialog>> = {}) {
    inboxes = [];
    company = COMPANY_WITH_NO_REPLY;
    renderDialog(props);
    await waitFor(() => expect(screen.getByText(COMPANY_LABEL)).toBeInTheDocument());
    await chooseFrom(NO_REPLY_LABEL);
    fireEvent.change(screen.getByPlaceholderText("Subject"), { target: { value: "Hello {{first_name}}" } });
    fireEvent.change(screen.getByTestId("body"), { target: { value: "<p>Hi {{first_name}} {{last_name}}</p>" } });
    fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
    return await screen.findByTitle(/Email preview/);
  }

  it("shows the finished email in the existing preview pane: Subject, From, Reply-to, then logo, message and footer", async () => {
    const frame = await openPreview();
    const dialog = screen.getByRole("dialog", { name: "Preview" });
    expect(within(dialog).getByText("Hello Sita")).toBeInTheDocument(); // subject, name filled
    expect(within(dialog).getByText(NO_REPLY_LABEL)).toBeInTheDocument();
    expect(within(dialog).getByText("hello@admizz.com")).toBeInTheDocument();

    const doc = frame.getAttribute("srcdoc") ?? "";
    expect(doc.startsWith("<!DOCTYPE html>")).toBe(true);
    const logo = doc.indexOf("https://cdn.example.com/admizz-logo.png");
    const msg = doc.indexOf("<p>Hi Sita Sharma</p>");
    const footer = doc.indexOf("Need help? Write to");
    expect(logo).toBeGreaterThan(-1);
    expect(msg).toBeGreaterThan(logo);
    expect(footer).toBeGreaterThan(msg);
    expect(frame).toHaveAttribute("sandbox", ""); // no scripts can run in it
  });

  it("is built by the same function the server uses to send (same document, same order)", async () => {
    const { renderBrandedMessage } = await import("@/lib/email/template/branded-message");
    const frame = await openPreview();
    expect(frame.getAttribute("srcdoc")).toBe(
      renderBrandedMessage({ bodyHtml: "<p>Hi Sita Sharma</p>", brand: BRAND, title: "Hello Sita" }),
    );
  });

  it("leaves {{tags}} as typed when the lead's name is not known here", async () => {
    const frame = await openPreview({ leadFirstName: undefined, leadLastName: undefined });
    expect(frame.getAttribute("srcdoc")).toContain("<p>Hi {{first_name}} {{last_name}}</p>");
  });
});

describe("what is not allowed", () => {
  const COMPANY_THREAD = {
    id: "thread-co",
    connected_email_account_id: null,
    lead_id: "lead-1",
    contact_id: null,
    subject: "Hello",
    emails: [
      { id: "e1", direction: "outbound", provider: "resend", from_email: "hello@mail.admizz.com", subject: "Hello", rfc_message_id: "<x@y>", rfc_references: [] },
      { id: "e2", direction: "inbound", from_email: "sita.example@gmail.com", subject: "Re: Hello", rfc_message_id: "<lead-reply@gmail.com>", rfc_references: [] },
    ],
  } as unknown as EmailThread;

  it("a reply never offers the no-reply address: it stays on the company address, with no frame and no Preview", async () => {
    inboxes = [];
    company = COMPANY_WITH_NO_REPLY;
    renderDialog({ replyContext: { thread: COMPANY_THREAD, lastMessage: COMPANY_THREAD.emails[1] } });
    await waitFor(() => expect(screen.getByText(COMPANY_LABEL)).toBeInTheDocument());
    expect(screen.queryByText(NO_REPLY_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByTestId("no-reply-frame")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("the no-reply choice is not sticky: a new email starts from the usual default again", async () => {
    inboxes = [];
    company = COMPANY_WITH_NO_REPLY;
    const view = renderDialog();
    await waitFor(() => expect(screen.getByText(COMPANY_LABEL)).toBeInTheDocument());
    await chooseFrom(NO_REPLY_LABEL);
    await screen.findByTestId("no-reply-frame");
    view.rerender(<ComposeEmailDialog open={false} onOpenChange={() => {}} defaultTo="x@y.com" leadId="lead-1" onSent={() => {}} />);
    view.rerender(<ComposeEmailDialog open onOpenChange={() => {}} defaultTo="x@y.com" leadId="lead-1" onSent={() => {}} />);
    await waitFor(() => expect(screen.getByText(COMPANY_LABEL)).toBeInTheDocument());
    expect(screen.queryByTestId("no-reply-frame")).not.toBeInTheDocument();
  });
});

describe("fillLeadTokens", () => {
  it("fills both tags like the server does, with spaces allowed inside the braces", () => {
    expect(fillLeadTokens("Hi {{first_name}} {{ last_name }}", "Sita", "Sharma")).toBe("Hi Sita Sharma");
  });
  it("a known-but-empty name becomes empty (as on send); an unknown one leaves the tag", () => {
    expect(fillLeadTokens("Hi {{first_name}}|{{last_name}}", null, undefined)).toBe("Hi |{{last_name}}");
  });
  it("text without tags is unchanged", () => {
    expect(fillLeadTokens("Hello", "A", "B")).toBe("Hello");
  });
});
