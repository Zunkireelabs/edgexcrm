// @vitest-environment jsdom
//
// Client request (WhatsApp, Oct 2026): "when uploading here too, make bulk possible" — the upload icon on the Documents
// card must take SEVERAL files at once (it took one). Pins: the picker is multi-file, the chosen files open the multi-file
// dialog (each named after itself, any document type on offer), uploads go out per file with the lead id, the card
// refreshes afterwards, and a read-only viewer still gets no upload control.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastSuccess, toastError, uploadMock } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn(), uploadMock: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));
vi.mock("./upload-document", () => ({ uploadApplicantDocument: uploadMock }));

import { ApplicantDocumentsCard } from "./documents-card";

const pdf = (name: string, lastModified = 1) => new File(["x"], name, { type: "application/pdf", lastModified });
const choose = (...files: File[]) => fireEvent.change(screen.getByTestId("documents-upload-input"), { target: { files } });
const listed = () => within(screen.getByTestId("multi-upload-list")).getAllByText(/\.(pdf|png)$/).map((n) => n.textContent);

let listCalls: number;
const originalFetch = global.fetch;

beforeEach(() => {
  listCalls = 0;
  toastSuccess.mockReset();
  toastError.mockReset();
  uploadMock.mockReset().mockResolvedValue({ ok: true });
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/documents") && (init?.method ?? "GET") === "GET") {
      listCalls++;
      return { ok: true, json: async () => ({ data: { documents: [], by_category: {} } }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

const renderCard = (canManage = true) =>
  render(<ApplicantDocumentsCard leadId="lead-1" canManage={canManage} currentUserId="u1" isAdmin={false} />);

describe("Documents card — bulk upload", () => {
  it("the upload control takes several files, with the same accepted types as before", async () => {
    renderCard();
    await screen.findByText(/no documents yet/i);
    const input = screen.getByTestId("documents-upload-input");
    expect(input).toHaveAttribute("multiple");
    expect(input.getAttribute("accept")).toContain("application/pdf");
    expect(screen.getByTitle("Upload documents")).toBeInTheDocument();
  });

  it("choosing several files opens ONE dialog listing all of them, each named after itself and typed 'Other'", async () => {
    renderCard();
    await screen.findByText(/no documents yet/i);
    choose(pdf("grade10.pdf"), pdf("grade12.pdf", 2), pdf("passport.pdf", 3));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(listed()).toEqual(["grade10.pdf", "grade12.pdf", "passport.pdf"]);
    expect(screen.getByLabelText("Name for grade10.pdf")).toHaveValue("grade10.pdf");
    expect(screen.getByRole("combobox", { name: "Type for grade10.pdf" })).toHaveTextContent("Other");
    expect(screen.getByText("3 of 10")).toBeInTheDocument();
  });

  it("uploads every file with this lead's id, in order, each with its own name; then the card reloads its list", async () => {
    renderCard();
    await screen.findByText(/no documents yet/i);
    const before = listCalls;
    choose(pdf("a.pdf"), pdf("b.pdf", 2));
    fireEvent.click(await screen.findByRole("button", { name: "Upload 2 files" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    expect(uploadMock.mock.calls.map((c) => [c[0].leadId, c[0].file.name, c[0].name, c[0].documentType])).toEqual([
      ["lead-1", "a.pdf", "a.pdf", "other"],
      ["lead-1", "b.pdf", "b.pdf", "other"],
    ]);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("2 documents uploaded"));
    await waitFor(() => expect(listCalls).toBeGreaterThan(before)); // the card shows what was just added
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a single file still works exactly like a batch of one", async () => {
    renderCard();
    await screen.findByText(/no documents yet/i);
    choose(pdf("only.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: "Upload 1 file" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("1 document uploaded"));
  });

  it("takes only the first 10 files and says so; unsupported files are left out with a reason", async () => {
    renderCard();
    await screen.findByText(/no documents yet/i);
    choose(...Array.from({ length: 12 }, (_, i) => pdf(`f${i}.pdf`, i)), new File(["x"], "sheet.xlsx"));
    await screen.findByRole("dialog");
    expect(listed()).toHaveLength(10);
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("sheet.xlsx isn't a supported file type"));
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("Only 10 files at a time"));
  });

  it("opens no dialog when nothing usable was chosen", async () => {
    renderCard();
    await screen.findByText(/no documents yet/i);
    choose(new File(["x"], "sheet.xlsx"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toastError).toHaveBeenCalled();
  });

  it("Cancel uploads nothing", async () => {
    renderCard();
    await screen.findByText(/no documents yet/i);
    choose(pdf("a.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("a read-only viewer gets no upload control at all", async () => {
    renderCard(false);
    await screen.findByText(/no documents yet/i);
    expect(screen.queryByTestId("documents-upload-input")).toBeNull();
    expect(screen.queryByTitle("Upload documents")).toBeNull();
  });
});
