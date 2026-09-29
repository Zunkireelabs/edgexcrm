// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { SendConsentDialog } from "./send-consent-dialog";

const LINK = "https://crm.test/consent/abc-123";
let fetchMock: ReturnType<typeof vi.fn>;
let sentVia: "email" | "link";

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  sentVia = "email";
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({ data: { id: "new", status: "sent", sent_via: sentVia, link: LINK } }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDialog(allowCopyOnly?: boolean) {
  render(
    <SendConsentDialog open onOpenChange={() => {}} leadId="lead-1" tenantId="tenant-1" allowCopyOnly={allowCopyOnly} onSuccess={() => {}} />
  );
}

const lastBody = () => JSON.parse((fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as RequestInit).body as string);

describe("SendConsentDialog — Copy link instead", () => {
  it("is hidden unless enabled (other callers unchanged)", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Send Consent Link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy link instead/i })).not.toBeInTheDocument();
  });

  it("Send Consent Link still emails (deliver: email) and says so", async () => {
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: "Send Consent Link" }));

    await screen.findByText("Consent link sent via email.");
    expect(lastBody()).toEqual({ action: "send", deliver: "email" });
  });

  it("Copy link instead creates the link without emailing and says so — not 'no email on file'", async () => {
    sentVia = "link";
    renderDialog(true);
    fireEvent.click(screen.getByRole("button", { name: /copy link instead/i }));

    await screen.findByText(/Link created — copy it and share it with the student\. No email was sent\./);
    expect(lastBody()).toEqual({ action: "send", deliver: "none" });
    expect(screen.queryByText(/No email on file/)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue(LINK)).toBeInTheDocument(); // the link row is shown, ready to copy
  });
});
