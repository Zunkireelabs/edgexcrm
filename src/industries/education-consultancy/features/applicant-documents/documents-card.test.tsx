// @vitest-environment jsdom
//
// Coverage for the Phase 2 UI: the empty state, category grouping, the
// canManage gate (no upload controls for a read-only viewer), the
// per-document delete gate (mirrors the server's admin-or-uploader rule —
// a review finding on PR #533: canManage alone is broader than the server's
// actual DELETE authorization, so an editor who isn't the uploader used to
// see a Delete button the server would then 403), the processing-status
// badge (a review finding on PR #534: a document that fails ingestion used
// to look identical to a fully ready one, since nothing read `status`), and
// that deleting a document actually calls DELETE and removes it from the
// list. Upload's presigned-PUT + checksum path is exercised by the manual
// smoke test (docs/APPLICANT-DOCUMENTS-STATUS.md §2c), not here — jsdom's
// crypto.subtle support is inconsistent across environments, and the API
// contract itself already has full route-level test coverage.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ApplicantDocumentsCard } from "./documents-card";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

const PASSPORT_DOC = {
  id: "doc-1",
  document_type: "passport",
  name: "passport.pdf",
  original_filename: "passport.pdf",
  mime_type: "application/pdf",
  file_size: 12345,
  status: "uploaded",
  processing_error: null as string | null,
  current_version_id: "v1",
  uploaded_by: "user-1",
  created_at: new Date().toISOString(),
};

const TRANSCRIPT_DOC = {
  ...PASSPORT_DOC,
  id: "doc-2",
  document_type: "transcript",
  name: "transcript.pdf",
  original_filename: "transcript.pdf",
};

function mockFetch(documents: typeof PASSPORT_DOC[]) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/documents") && method === "GET") {
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: { documents, by_category: {} } }),
      } as Response);
    }
    if (url.match(/\/api\/v1\/documents\/[\w-]+$/) && method === "DELETE") {
      return Promise.resolve({ ok: true, json: async () => ({ data: { deleted: true } }) } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: { message: "not found" } }) } as Response);
  });
}

describe("ApplicantDocumentsCard", () => {
  const originalFetch = global.fetch;
  const originalConfirm = window.confirm;

  beforeEach(() => {
    window.confirm = vi.fn(() => true);
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    window.confirm = originalConfirm;
    vi.restoreAllMocks();
  });

  it("renders the empty state when there are no documents", async () => {
    global.fetch = mockFetch([]) as unknown as typeof fetch;

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={true} currentUserId="user-1" isAdmin={false} />);

    await waitFor(() => expect(screen.getByText(/no documents yet/i)).toBeInTheDocument());
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("groups documents by category and shows the total count", async () => {
    global.fetch = mockFetch([PASSPORT_DOC, TRANSCRIPT_DOC]) as unknown as typeof fetch;

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={true} currentUserId="user-1" isAdmin={false} />);

    await waitFor(() => expect(screen.getByText("passport.pdf")).toBeInTheDocument());
    expect(screen.getByText("transcript.pdf")).toBeInTheDocument();
    // passport -> Identity, transcript -> Education (DOCUMENT_TYPE_CATEGORY)
    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Education")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("hides the upload controls for a read-only viewer (canManage=false)", async () => {
    global.fetch = mockFetch([PASSPORT_DOC]) as unknown as typeof fetch;

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={false} currentUserId="user-1" isAdmin={false} />);

    await waitFor(() => expect(screen.getByText("passport.pdf")).toBeInTheDocument());
    expect(screen.queryByTitle("Upload document")).not.toBeInTheDocument();
  });

  it("REGRESSION (PR #533 review): hides Delete for an editor who can manage but did not upload the document", async () => {
    global.fetch = mockFetch([PASSPORT_DOC]) as unknown as typeof fetch;

    // canManage=true (e.g. a counselor with edit rights) but neither the
    // uploader (PASSPORT_DOC.uploaded_by === "user-1") nor an admin — the
    // server's DELETE route would 403 this caller, so the button must not
    // even render.
    render(<ApplicantDocumentsCard leadId="lead-1" canManage={true} currentUserId="user-2" isAdmin={false} />);

    await waitFor(() => expect(screen.getByText("passport.pdf")).toBeInTheDocument());
    expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
  });

  it("shows Delete for the original uploader even without admin rights", async () => {
    global.fetch = mockFetch([PASSPORT_DOC]) as unknown as typeof fetch;

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={true} currentUserId="user-1" isAdmin={false} />);

    await waitFor(() => expect(screen.getByText("passport.pdf")).toBeInTheDocument());
    expect(screen.getByTitle("Delete")).toBeInTheDocument();
  });

  it("shows Delete for an admin regardless of who uploaded the document", async () => {
    global.fetch = mockFetch([PASSPORT_DOC]) as unknown as typeof fetch;

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={true} currentUserId="user-2" isAdmin={true} />);

    await waitFor(() => expect(screen.getByText("passport.pdf")).toBeInTheDocument());
    expect(screen.getByTitle("Delete")).toBeInTheDocument();
  });

  it("shows no status badge for a normal uploaded/ready document (no news is good news)", async () => {
    global.fetch = mockFetch([{ ...PASSPORT_DOC, status: "ready" }]) as unknown as typeof fetch;

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={true} currentUserId="user-1" isAdmin={false} />);

    await waitFor(() => expect(screen.getByText("passport.pdf")).toBeInTheDocument());
    expect(screen.queryByText("Processing")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("shows a Processing badge while the document is queued or processing", async () => {
    global.fetch = mockFetch([{ ...PASSPORT_DOC, status: "processing" }]) as unknown as typeof fetch;

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={true} currentUserId="user-1" isAdmin={false} />);

    await waitFor(() => expect(screen.getByText("passport.pdf")).toBeInTheDocument());
    expect(screen.getByText("Processing")).toBeInTheDocument();
  });

  it("REGRESSION (PR #534 review): shows a Failed badge with the error in a tooltip when ingestion fails", async () => {
    global.fetch = mockFetch([
      { ...PASSPORT_DOC, status: "failed", processing_error: "OCR could not read the scanned page" },
    ]) as unknown as typeof fetch;

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={true} currentUserId="user-1" isAdmin={false} />);

    await waitFor(() => expect(screen.getByText("passport.pdf")).toBeInTheDocument());
    const badge = screen.getByText("Failed");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("title", "OCR could not read the scanned page");
  });

  it("deletes a document and removes it from the list", async () => {
    const fetchMock = mockFetch([PASSPORT_DOC]);
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={true} currentUserId="user-1" isAdmin={false} />);

    await waitFor(() => expect(screen.getByText("passport.pdf")).toBeInTheDocument());

    fireEvent.click(screen.getByTitle("Delete"));

    await waitFor(() => expect(screen.queryByText("passport.pdf")).not.toBeInTheDocument());
    expect(window.confirm).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/documents/doc-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Document deleted");
  });
});
