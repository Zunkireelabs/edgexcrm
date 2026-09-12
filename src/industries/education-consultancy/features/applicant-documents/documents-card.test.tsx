// @vitest-environment jsdom
//
// Coverage for the Phase 2 UI: the empty state, category grouping, the
// canManage gate (no upload/delete controls for a read-only viewer), and
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

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={true} />);

    await waitFor(() => expect(screen.getByText(/no documents yet/i)).toBeInTheDocument());
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("groups documents by category and shows the total count", async () => {
    global.fetch = mockFetch([PASSPORT_DOC, TRANSCRIPT_DOC]) as unknown as typeof fetch;

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={true} />);

    await waitFor(() => expect(screen.getByText("passport.pdf")).toBeInTheDocument());
    expect(screen.getByText("transcript.pdf")).toBeInTheDocument();
    // passport -> Identity, transcript -> Education (DOCUMENT_TYPE_CATEGORY)
    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Education")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("hides the upload and delete controls for a read-only viewer (canManage=false)", async () => {
    global.fetch = mockFetch([PASSPORT_DOC]) as unknown as typeof fetch;

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={false} />);

    await waitFor(() => expect(screen.getByText("passport.pdf")).toBeInTheDocument());
    expect(screen.queryByTitle("Upload document")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
  });

  it("deletes a document and removes it from the list", async () => {
    const fetchMock = mockFetch([PASSPORT_DOC]);
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ApplicantDocumentsCard leadId="lead-1" canManage={true} />);

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
