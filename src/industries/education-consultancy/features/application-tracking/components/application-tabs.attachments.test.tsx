// @vitest-environment jsdom
//
// Client request (application page, Notes): attach the university's offer documents to a note, name them, and
// have them show up under the application in Documents. The note is saved FIRST, then each file is uploaded and
// tied to that note + application; a failed file never loses the note and a retry goes to the same note.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastSuccess, toastError, uploadMock } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn(), uploadMock: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));
vi.mock("../../applicant-documents/upload-document", () => ({ uploadApplicantDocument: uploadMock }));

import { ApplicationTabs } from "./application-tabs";

const APP = "app-1";
const LEAD = "lead-1";
let notesOnServer: Record<string, unknown>[];
let postedBodies: unknown[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  uploadMock.mockReset();
  notesOnServer = [];
  postedBodies = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `/api/v1/applications/${APP}/notes` && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      postedBodies.push(body);
      const note = { id: `note-${postedBodies.length}`, user_id: "u1", user_email: "a@b.c", content: body.content, created_at: "2026-10-05T00:00:00Z", documents: [] };
      notesOnServer = [note, ...notesOnServer];
      return { ok: true, status: 201, json: async () => ({ data: note }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: notesOnServer }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: (() => { let n = 0; return () => `id-${++n}`; })() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderTabs(props: { canAttach?: boolean; offerType?: string | null } = {}) {
  render(
    <ApplicationTabs
      applicationId={APP}
      timeline={[]}
      teamMemberEmails={{}}
      currentUserId="u1"
      leadId={LEAD}
      canAttach={props.canAttach ?? true}
      offerType={props.offerType ?? null}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Notes/ }));
}
const pdf = (name = "offer.pdf") => new File(["x"], name, { type: "application/pdf" });
const attach = (...files: File[]) => fireEvent.change(screen.getByTestId("note-file-input"), { target: { files } });
const addNoteButton = () => screen.getByRole("button", { name: /Add Note|Retry upload/ });

describe("attach button", () => {
  it("is shown to people who can add notes", async () => {
    renderTabs({ canAttach: true });
    expect(await screen.findByRole("button", { name: /Attach document/ })).toBeInTheDocument();
  });

  it("is hidden for people who cannot attach", async () => {
    renderTabs({ canAttach: false });
    await screen.findByPlaceholderText("Add a note...");
    expect(screen.queryByRole("button", { name: /Attach document/ })).toBeNull();
  });
});

describe("choosing files", () => {
  it("lists each file with a Name and a Type, defaulting the type from the application's offer", async () => {
    renderTabs({ offerType: "conditional" });
    await screen.findByPlaceholderText("Add a note...");
    attach(pdf("arden-offer.pdf"));
    expect(await screen.findByText("arden-offer.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("placeholder", "arden-offer.pdf");
    expect(screen.getByRole("combobox", { name: /Type for arden-offer.pdf/ })).toHaveTextContent("Conditional Offer");
  });

  it("defaults to a plain Offer Letter when the application has no offer type", async () => {
    renderTabs({ offerType: null });
    await screen.findByPlaceholderText("Add a note...");
    attach(pdf());
    expect(await screen.findByRole("combobox", { name: /Type for offer.pdf/ })).toHaveTextContent("Offer Letter");
  });

  it("lets a file be removed before saving", async () => {
    renderTabs();
    await screen.findByPlaceholderText("Add a note...");
    attach(pdf("a.pdf"), pdf("b.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove a.pdf" }));
    expect(screen.queryByText("a.pdf")).toBeNull();
    expect(screen.getByText("b.pdf")).toBeInTheDocument();
  });

  it("enables Add Note for a file alone, with no text typed", async () => {
    renderTabs();
    await screen.findByPlaceholderText("Add a note...");
    expect(addNoteButton()).toBeDisabled();
    attach(pdf());
    await screen.findByText("offer.pdf");
    expect(addNoteButton()).toBeEnabled();
  });
});

describe("saving a note with documents", () => {
  it("saves the note FIRST, then uploads each file tied to that note and this application", async () => {
    uploadMock.mockResolvedValue({ ok: true });
    renderTabs({ offerType: "unconditional" });
    fireEvent.change(await screen.findByPlaceholderText("Add a note..."), { target: { value: "Offer received from Arden" } });
    attach(pdf("offer.pdf"));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Arden unconditional offer" } });
    fireEvent.click(addNoteButton());

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(postedBodies).toEqual([{ content: "Offer received from Arden" }]);
    expect(uploadMock).toHaveBeenCalledWith({
      leadId: LEAD,
      file: expect.any(File),
      documentType: "unconditional_offer",
      name: "Arden unconditional offer",
      applicationId: APP,
      applicationNoteId: "note-1",
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Note added with documents"));
  });

  it("with files but no text, the note says what was attached — never an empty note", async () => {
    uploadMock.mockResolvedValue({ ok: true });
    renderTabs();
    await screen.findByPlaceholderText("Add a note...");
    attach(pdf("offer.pdf"));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Arden offer" } });
    fireEvent.click(addNoteButton());
    await waitFor(() => expect(postedBodies).toEqual([{ content: "Attached: Arden offer" }]));
  });

  it("shows the attached files on the note after saving", async () => {
    uploadMock.mockImplementation(async () => {
      notesOnServer = notesOnServer.map((n) => ({
        ...n,
        documents: [{ id: "d1", name: "Arden offer", document_type: "conditional_offer", original_filename: "offer.pdf", mime_type: "application/pdf", file_size: 2048 }],
      }));
      return { ok: true };
    });
    renderTabs();
    fireEvent.change(await screen.findByPlaceholderText("Add a note..."), { target: { value: "Offer in" } });
    attach(pdf());
    await screen.findByText("offer.pdf");
    fireEvent.click(addNoteButton());
    const list = await screen.findByRole("list", { name: "Attached documents" });
    expect(within(list).getByText("Arden offer")).toBeInTheDocument();
    expect(within(list).getByText(/Conditional Offer/)).toBeInTheDocument();
  });

  it("a plain note (no files) uploads nothing", async () => {
    renderTabs();
    fireEvent.change(await screen.findByPlaceholderText("Add a note..."), { target: { value: "Just a note" } });
    fireEvent.click(addNoteButton());
    await waitFor(() => expect(postedBodies).toEqual([{ content: "Just a note" }]));
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("when an upload fails", () => {
  it("keeps the saved note, keeps the failed file with its reason, and offers a retry", async () => {
    uploadMock.mockResolvedValue({ ok: false, message: "The file was not found in storage" });
    renderTabs();
    fireEvent.change(await screen.findByPlaceholderText("Add a note..."), { target: { value: "Offer in" } });
    attach(pdf());
    await screen.findByText("offer.pdf");
    fireEvent.click(addNoteButton());

    expect(await screen.findByText(/Not uploaded: The file was not found in storage/)).toBeInTheDocument();
    expect(screen.getByText(/Your note was saved\. 1 file did not upload\./)).toBeInTheDocument();
    expect(screen.getByText("Offer in")).toBeInTheDocument(); // the note is in the list
    expect(screen.getByRole("button", { name: "Retry upload (1)" })).toBeEnabled();
    expect(toastError).toHaveBeenCalled();
  });

  it("retry uploads to the SAME note and does not create a second one", async () => {
    uploadMock.mockResolvedValueOnce({ ok: false, message: "boom" }).mockResolvedValueOnce({ ok: true });
    renderTabs();
    fireEvent.change(await screen.findByPlaceholderText("Add a note..."), { target: { value: "Offer in" } });
    attach(pdf());
    await screen.findByText("offer.pdf");
    fireEvent.click(addNoteButton());
    fireEvent.click(await screen.findByRole("button", { name: "Retry upload (1)" }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    expect(postedBodies).toHaveLength(1); // still just the one note
    expect(uploadMock.mock.calls[1][0]).toMatchObject({ applicationNoteId: "note-1", applicationId: APP });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Documents attached"));
    expect(screen.queryByText(/did not upload/)).toBeNull();
  });

  it("lets the counselor discard the failed files", async () => {
    uploadMock.mockResolvedValue({ ok: false, message: "boom" });
    renderTabs();
    fireEvent.change(await screen.findByPlaceholderText("Add a note..."), { target: { value: "Offer in" } });
    attach(pdf());
    await screen.findByText("offer.pdf");
    fireEvent.click(addNoteButton());
    fireEvent.click(await screen.findByRole("button", { name: "Discard files" }));
    expect(screen.queryByText("offer.pdf")).toBeNull();
    expect(screen.queryByText(/did not upload/)).toBeNull();
    expect(screen.getByRole("button", { name: /Add Note/ })).toBeDisabled();
  });
});
