// @vitest-environment jsdom
//
// Application page: a Documents tab listing every file on THIS application, and "Add documents" on an
// existing note (files go to that same note, tied to this application).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastSuccess, toastError, uploadMock } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn(), uploadMock: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));
vi.mock("../../applicant-documents/upload-document", () => ({ uploadApplicantDocument: uploadMock }));

import { ApplicationTabs } from "./application-tabs";

const APP = "app-1";
const LEAD = "lead-1";
const base = { mime_type: "application/pdf", file_size: 1000, original_filename: "f.pdf", uploaded_by: "u1", created_at: "2026-10-05T00:00:00Z" };
let studentDocs: Record<string, unknown>[];
let notes: Record<string, unknown>[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  uploadMock.mockReset();
  notes = [{ id: "n1", user_id: "u1", user_email: "a@b.c", content: "Offer in", created_at: "2026-10-05T00:00:00Z", documents: [{ ...base, id: "d1", name: "Arden conditional offer", document_type: "conditional_offer" }] }];
  studentDocs = [
    { ...base, id: "d1", name: "Arden conditional offer", document_type: "conditional_offer", application_id: APP },
    { ...base, id: "d2", name: "Arden unconditional offer", document_type: "unconditional_offer", application_id: APP },
    { ...base, id: "d3", name: "York offer", document_type: "offer_letter", application_id: "other-app" },
    { ...base, id: "d4", name: "My passport", document_type: "passport", application_id: null },
  ];
  fetchMock = vi.fn(async (url: string) => {
    if (url === `/api/v1/leads/${LEAD}/documents`) return { ok: true, status: 200, json: async () => ({ data: { documents: studentDocs, applications: {} } }) };
    return { ok: true, status: 200, json: async () => ({ data: notes }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: (() => { let n = 0; return () => `id-${++n}`; })() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderTabs = (over: { canAttach?: boolean } = {}) =>
  render(
    <ApplicationTabs
      applicationId={APP} timeline={[]} teamMemberEmails={{}} currentUserId="u1" leadId={LEAD}
      canAttach={over.canAttach ?? true} offerType="conditional" isAdmin={false}
    />,
  );

describe("Documents tab", () => {
  it("lists only the files on THIS application — not other applications' or general documents", async () => {
    renderTabs();
    fireEvent.click(await screen.findByRole("button", { name: /^Documents/ }));
    const list = await screen.findByRole("list", { name: "Application documents" });
    expect(within(list).getByText("Arden conditional offer")).toBeInTheDocument();
    expect(within(list).getByText("Arden unconditional offer")).toBeInTheDocument();
    expect(within(list).queryByText("York offer")).toBeNull();
    expect(within(list).queryByText("My passport")).toBeNull();
  });

  it("shows a count on the tab", async () => {
    renderTabs();
    const tab = await screen.findByRole("button", { name: /^Documents/ });
    await waitFor(() => expect(within(tab).getByText("2")).toBeInTheDocument());
  });

  it("explains how to add documents when there are none", async () => {
    studentDocs = [];
    renderTabs();
    fireEvent.click(await screen.findByRole("button", { name: /^Documents/ }));
    expect(await screen.findByText(/No documents on this application yet\. Attach them from a note/)).toBeInTheDocument();
  });

  it("does not tell a view-only user to attach anything", async () => {
    studentDocs = [];
    renderTabs({ canAttach: false });
    fireEvent.click(await screen.findByRole("button", { name: /^Documents/ }));
    const empty = await screen.findByText(/No documents on this application yet\./);
    expect(empty.textContent).not.toMatch(/Attach them from a note/);
  });
});

describe("Add documents to an existing note", () => {
  const openNotes = async () => {
    renderTabs();
    fireEvent.click(await screen.findByRole("button", { name: /^Notes/ }));
    await screen.findByText("Offer in");
  };
  const choose = (...files: File[]) => {
    const inputs = screen.getAllByTestId("note-file-input");
    fireEvent.change(inputs[inputs.length - 1], { target: { files } }); // the per-note panel's input is the last one
  };

  it("uploads to THAT note and this application, then refreshes", async () => {
    uploadMock.mockResolvedValue({ ok: true });
    await openNotes();
    fireEvent.click(screen.getByRole("button", { name: /Add documents/ }));
    choose(new File(["x"], "unconditional.pdf", { type: "application/pdf" }));
    fireEvent.click(await screen.findByRole("button", { name: "Upload (1)" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({
      leadId: LEAD, applicationId: APP, applicationNoteId: "n1", documentType: "conditional_offer",
    }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Documents attached"));
    expect(screen.queryByTestId("add-documents-n1")).toBeNull(); // panel closes on success
  });

  it("keeps a failed file in the panel with its reason, so it can be retried", async () => {
    uploadMock.mockResolvedValue({ ok: false, message: "The file was not found in storage" });
    await openNotes();
    fireEvent.click(screen.getByRole("button", { name: /Add documents/ }));
    choose(new File(["x"], "offer2.pdf", { type: "application/pdf" }));
    fireEvent.click(await screen.findByRole("button", { name: "Upload (1)" }));
    expect(await screen.findByText(/Not uploaded: The file was not found in storage/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload (1)" })).toBeEnabled(); // still there to retry
    expect(toastError).toHaveBeenCalled();
  });

  it("can be cancelled without uploading anything", async () => {
    await openNotes();
    fireEvent.click(screen.getByRole("button", { name: /Add documents/ }));
    choose(new File(["x"], "offer2.pdf", { type: "application/pdf" }));
    await screen.findByText("offer2.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(uploadMock).not.toHaveBeenCalled();
    expect(screen.queryByText("offer2.pdf")).toBeNull();
  });

  it("is not offered to people who cannot attach", async () => {
    renderTabs({ canAttach: false });
    fireEvent.click(await screen.findByRole("button", { name: /^Notes/ }));
    await screen.findByText("Offer in");
    expect(screen.queryByRole("button", { name: /Add documents/ })).toBeNull();
  });
});
