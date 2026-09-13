// @vitest-environment jsdom
//
// Round 2 slice E §3.6 — the email→task flow
// (docs/IT-AGENCY-ROUND2-SLICE-E-CAPTURE-BRIEF.md). The Create task button
// is universal but gated on `leadId`; clicking it must prefill the inline
// TaskComposer with the thread's subject and a plain-text (no HTML tags)
// version of the last inbound email.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EmailThreadCard } from "./email-thread-card";
import type { EmailThread } from "../hooks/use-email-threads";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const THREAD: EmailThread = {
  id: "thread-1",
  connected_email_account_id: "acct-1",
  gmail_thread_id: "g-1",
  lead_id: "lead-1",
  contact_id: null,
  subject: "Re: Proposal for Q4",
  last_message_at: "2026-09-10T10:00:00Z",
  message_count: 1,
  created_at: "2026-09-10T10:00:00Z",
  updated_at: "2026-09-10T10:00:00Z",
  emails: [
    {
      id: "email-1",
      direction: "inbound",
      from_email: "jane@client.com",
      from_name: "Jane Doe",
      to_emails: ["me@agency.com"],
      cc_emails: [],
      subject: "Re: Proposal for Q4",
      body_html: "<p>Hi there,</p><p>Can you <b>resend</b> the pricing sheet?</p>",
      sent_at: "2026-09-10T10:00:00Z",
      received_at: null,
      read_at: null,
      sender_user_id: null,
      in_reply_to: null,
      rfc_references: [],
      rfc_message_id: "msg-1",
      gmail_message_id: "g-msg-1",
    },
  ],
};

function renderCard(props: Partial<React.ComponentProps<typeof EmailThreadCard>> = {}) {
  return render(
    <EmailThreadCard
      thread={THREAD}
      currentUserId="user-1"
      teamMemberEmails={{}}
      ownConnectedInboxes={[]}
      onReply={vi.fn()}
      {...props}
    />,
  );
}

function expandThread() {
  fireEvent.click(screen.getByText("Re: Proposal for Q4"));
}

describe("EmailThreadCard — Create task (Round 2 slice E §3.6)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("does not show Create task when leadId is absent", () => {
    renderCard({ leadId: undefined });
    expandThread();
    expect(screen.queryByText("Create task")).not.toBeInTheDocument();
  });

  it("shows Create task only when leadId is set", () => {
    renderCard({ leadId: "lead-1" });
    expandThread();
    expect(screen.getByText("Create task")).toBeInTheDocument();
  });

  it("prefills the composer with the subject and a plain-text (no HTML) body", () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })) as unknown as typeof fetch;
    renderCard({ leadId: "lead-1" });
    expandThread();
    fireEvent.click(screen.getByText("Create task"));

    const titleInput = screen.getByPlaceholderText("Task title") as HTMLInputElement;
    expect(titleInput.value).toBe("Re: Proposal for Q4");

    const descriptionTextarea = screen.getByPlaceholderText("Description (optional)") as HTMLTextAreaElement;
    expect(descriptionTextarea.value).not.toMatch(/<[^>]+>/); // no raw HTML tags
    expect(descriptionTextarea.value).toContain("Can you resend the pricing sheet?");
    expect(descriptionTextarea.value).toContain("Jane Doe");
  });

  it("Cancel on the inline composer closes it and shows the Create task button again", () => {
    renderCard({ leadId: "lead-1" });
    expandThread();
    fireEvent.click(screen.getByText("Create task"));
    expect(screen.queryByText("Create task")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Create task")).toBeInTheDocument();
  });
});
