// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: async () => ({ error: null }) }) } }),
}));

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

// Bijay Dahal (Admizz), 2026-11-05: "Record Manually" failed with "Failed to get upload URL". The dialog sent the SAME
// session_id / field_name for every student, so every upload resolved to the same storage path and storage refuses to
// overwrite an existing object — only the first upload of each file type could ever succeed.
describe("SendConsentDialog — Record Manually upload", () => {
  const uploadCalls = () => fetchMock.mock.calls.filter((c) => c[0] === "/api/v1/upload").map((c) => JSON.parse((c[1] as RequestInit).body as string));

  function renderManual() {
    render(<SendConsentDialog open onOpenChange={() => {}} leadId="lead-1" tenantId="tenant-1" defaultTab="manual" onSuccess={() => {}} />);
  }
  const pickFile = (name = "signed.pdf") => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "application/pdf" })] } });
  };
  const okUpload = () =>
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { path: "p", token: "t", public_url: `https://files.test/${url}` } }),
    }));

  it("sends a lead-scoped session_id and a unique consent-document field_name (never the old shared constants)", async () => {
    fetchMock = okUpload();
    vi.stubGlobal("fetch", fetchMock);
    renderManual();
    pickFile();
    await waitFor(() => expect(uploadCalls()).toHaveLength(1));
    const [body] = uploadCalls();
    expect(body.session_id).toBe("lead-1");
    expect(body.field_name).toMatch(/^consent-document-[0-9a-f-]{36}$/);
    expect(body.session_id).not.toBe("consent");
    expect(body.field_name).not.toBe("consent_document");
  });

  it("two uploads in a row never share a path (the collision that broke every upload after the first)", async () => {
    fetchMock = okUpload();
    vi.stubGlobal("fetch", fetchMock);
    renderManual();
    pickFile();
    await waitFor(() => expect(screen.getByText("Document uploaded")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Remove"));
    pickFile("second.pdf");
    await waitFor(() => expect(uploadCalls()).toHaveLength(2));
    const [first, second] = uploadCalls();
    expect(first.field_name).not.toBe(second.field_name);
  });

  it("shows the REAL reason when the upload is refused (file too large), not a vague generic message", async () => {
    fetchMock = vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: { code: "VALIDATION_ERROR", message: "Validation failed", details: { file_size: ["File too large. Maximum size is 10MB"] } } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderManual();
    pickFile();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("File too large. Maximum size is 10MB"));
  });

  it("falls back to the generic message when the server gives no usable body", async () => {
    fetchMock = vi.fn(async () => ({ ok: false, status: 503, json: async () => { throw new Error("no body"); } }));
    vi.stubGlobal("fetch", fetchMock);
    renderManual();
    pickFile();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Failed to get upload URL"));
  });
});
