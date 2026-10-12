// @vitest-environment jsdom
//
// The lead page shows the Documents card twice for the same student (the Documents tab and the summary card on the right).
// An upload or a delete in one must refresh the other — before, the right card kept the old count until a page reload.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// Stand-in for the bulk upload dialog: one button that reports "upload finished", like the real dialog does.
vi.mock("./multi-document-upload-dialog", () => ({
  MultiDocumentUploadDialog: ({ onUploaded }: { onUploaded: () => void }) => (
    <button type="button" onClick={onUploaded}>finish upload</button>
  ),
}));

import { ApplicantDocumentsCard } from "./documents-card";

const doc = (id: string) => ({
  id, document_type: "marksheet", name: `${id}.pdf`, original_filename: `${id}.pdf`, mime_type: "application/pdf", file_size: 1000,
  status: "ready", processing_error: null, current_version_id: `v-${id}`, uploaded_by: "u1", created_at: new Date().toISOString(),
});

let documents: ReturnType<typeof doc>[];
const originalFetch = global.fetch;
const originalConfirm = window.confirm;

beforeEach(() => {
  documents = [doc("grade12")];
  window.confirm = vi.fn(() => true);
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/documents") && method === "GET") {
      return { ok: true, json: async () => ({ data: { documents: [...documents], by_category: {}, applications: {} } }) } as Response;
    }
    if (method === "DELETE") {
      documents = [];
      return { ok: true, json: async () => ({ data: { deleted: true } }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  window.confirm = originalConfirm;
});

const renderTwoCards = () =>
  render(
    <>
      <div data-testid="tab"><ApplicantDocumentsCard leadId="lead-1" canManage currentUserId="u1" isAdmin /></div>
      <div data-testid="summary"><ApplicantDocumentsCard leadId="lead-1" canManage currentUserId="u1" isAdmin /></div>
    </>,
  );

describe("two Documents cards for the same lead stay in step", () => {
  it("a delete in one card removes the document from the other too", async () => {
    renderTwoCards();
    await waitFor(() => expect(screen.getAllByText("grade12.pdf")).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("button", { name: "Delete grade12.pdf" })[0]);
    await waitFor(() => expect(screen.queryAllByText("grade12.pdf")).toHaveLength(0));
  });

  it("a finished upload in one card refreshes the other card's list", async () => {
    renderTwoCards();
    await waitFor(() => expect(screen.getAllByText("grade12.pdf")).toHaveLength(2));
    documents = [doc("grade12"), doc("passport")]; // what the server now holds after the upload
    fireEvent.click(screen.getAllByText("finish upload")[0]);
    await waitFor(() => expect(screen.getAllByText("passport.pdf")).toHaveLength(2));
  });
});
