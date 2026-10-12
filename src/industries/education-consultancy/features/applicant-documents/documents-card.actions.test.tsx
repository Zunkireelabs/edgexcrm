// @vitest-environment jsdom
//
// Client request (WhatsApp, Oct 2026): every document gets three icons — View (eye), Replace, Delete (trash). Replace uploads a
// NEW VERSION of the same document. Pins: who sees which icon, that View still opens the viewer, the whole Replace flow (picker
// -> upload -> toast -> the card reloads), and that a bad / cancelled / failed replace never touches the document.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastSuccess, toastError, replaceMock } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn(), replaceMock: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));
vi.mock("./replace-document", () => ({ replaceDocumentFile: replaceMock }));

import { ApplicantDocumentsCard } from "./documents-card";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const doc = (id: string, over: Record<string, unknown> = {}) => ({
  id, document_type: "marksheet", name: `${id}.pdf`, original_filename: `${id}.pdf`, mime_type: "application/pdf", file_size: 716_930,
  status: "ready", processing_error: null, current_version_id: `v-${id}`, uploaded_by: "u1", created_at: daysAgo(3), ...over,
});

let documents: ReturnType<typeof doc>[];
let listCalls: number;
let viewerCalls: string[];
const originalFetch = global.fetch;
const originalConfirm = window.confirm;

beforeEach(() => {
  documents = [doc("grade12"), doc("passport", { document_type: "passport", uploaded_by: "someone-else" })];
  listCalls = 0;
  viewerCalls = [];
  toastSuccess.mockReset();
  toastError.mockReset();
  replaceMock.mockReset().mockResolvedValue({ ok: true });
  window.confirm = vi.fn(() => true);
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/documents") && method === "GET") {
      listCalls++;
      return { ok: true, json: async () => ({ data: { documents, by_category: {}, applications: {} } }) } as Response;
    }
    if (url.endsWith("/download-url")) {
      viewerCalls.push(url);
      return { ok: true, json: async () => ({ data: { url: "https://files.test/x.pdf" } }) } as Response;
    }
    if (method === "DELETE") {
      // the fake server really removes it, so the card's refetch after a delete agrees (like the real one)
      documents = documents.filter((d) => !url.endsWith(`/${d.id}`));
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

const renderCard = (over: Partial<React.ComponentProps<typeof ApplicantDocumentsCard>> = {}) =>
  render(<ApplicantDocumentsCard leadId="lead-1" canManage currentUserId="u1" isAdmin={false} {...over} />);
const row = (name: string) => screen.getByText(name).closest("div.border") as HTMLElement;
const pdf = (name = "new-scan.pdf") => new File(["x"], name, { type: "application/pdf" });
const choose = (...files: File[]) => fireEvent.change(screen.getByTestId("documents-replace-input"), { target: { files } });

describe("the three icons", () => {
  it("each document has View, Replace and Delete, as labelled icons", async () => {
    renderCard();
    await screen.findByText("grade12.pdf");
    const r = within(row("grade12.pdf"));
    expect(r.getByRole("button", { name: "View grade12.pdf" })).toHaveAttribute("title", "View");
    expect(r.getByRole("button", { name: "Replace grade12.pdf" })).toHaveAttribute("title", "Replace");
    expect(r.getByRole("button", { name: "Delete grade12.pdf" })).toHaveAttribute("title", "Delete");
  });

  it("are in the order View, Replace, Delete", async () => {
    renderCard();
    await screen.findByText("grade12.pdf");
    const group = screen.getByRole("group", { name: "Actions for grade12.pdf" });
    expect(within(group).getAllByRole("button").map((b) => b.getAttribute("title"))).toEqual(["View", "Replace", "Delete"]);
  });

  it("show the size and how long ago it was uploaded, next to the icons", async () => {
    renderCard();
    await screen.findByText("grade12.pdf");
    expect(within(row("grade12.pdf")).getByText(/Marksheet · 700\.1 KB · Uploaded 3 days ago/)).toBeInTheDocument();
  });

  it("a read-only viewer can still View, but has no Replace and no Delete", async () => {
    renderCard({ canManage: false });
    await screen.findByText("grade12.pdf");
    const r = within(row("grade12.pdf"));
    expect(r.getByRole("button", { name: "View grade12.pdf" })).toBeInTheDocument();
    expect(r.queryByRole("button", { name: /Replace/ })).toBeNull();
    expect(screen.queryByTestId("documents-replace-input")).toBeNull();
  });

  it("Delete still follows its own rule: only an admin or the uploader (Replace follows upload rights)", async () => {
    renderCard({ isAdmin: false, currentUserId: "u1" });
    await screen.findByText("passport.pdf");
    const others = within(row("passport.pdf")); // uploaded by someone else
    expect(others.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(others.getByRole("button", { name: "Replace passport.pdf" })).toBeInTheDocument(); // can upload, so can replace
    expect(within(row("grade12.pdf")).getByRole("button", { name: /Delete/ })).toBeInTheDocument(); // their own
  });

  it("an admin can delete anyone's", async () => {
    renderCard({ isAdmin: true });
    await screen.findByText("passport.pdf");
    expect(within(row("passport.pdf")).getByRole("button", { name: /Delete/ })).toBeInTheDocument();
  });

  it("View opens the viewer for that document", async () => {
    renderCard();
    await screen.findByText("grade12.pdf");
    fireEvent.click(within(row("grade12.pdf")).getByRole("button", { name: "View grade12.pdf" }));
    await waitFor(() => expect(viewerCalls).toEqual(["/api/v1/documents/grade12/download-url"]));
  });

  it("Delete still asks first, deletes, and removes the row", async () => {
    renderCard();
    await screen.findByText("grade12.pdf");
    fireEvent.click(within(row("grade12.pdf")).getByRole("button", { name: "Delete grade12.pdf" }));
    await waitFor(() => expect(screen.queryByText("grade12.pdf")).toBeNull());
    expect(window.confirm).toHaveBeenCalled();
  });

  it("the grid view has the same three icons", async () => {
    renderCard();
    await screen.findByText("grade12.pdf");
    fireEvent.click(screen.getByTitle(/switch to grid view/i));
    const group = await screen.findByRole("group", { name: "Actions for grade12.pdf" });
    expect(within(group).getAllByRole("button").map((b) => b.getAttribute("title"))).toEqual(["View", "Replace", "Delete"]);
  });

  it("the small card on the lead page has them too", async () => {
    renderCard({ variant: "summary" });
    await screen.findByText("grade12.pdf");
    expect(screen.getByRole("button", { name: "Replace grade12.pdf" })).toBeInTheDocument();
  });
});

describe("Replace", () => {
  const clickReplace = async (name = "grade12.pdf") => {
    renderCard();
    await screen.findByText(name);
    fireEvent.click(within(row(name)).getByRole("button", { name: `Replace ${name}` }));
  };

  it("opens ONE file picker (a single file, the supported types) when the icon is clicked", async () => {
    await clickReplace();
    const input = screen.getByTestId("documents-replace-input");
    expect(input).not.toHaveAttribute("multiple");
    expect(input.getAttribute("accept")).toContain("application/pdf");
  });

  it("uploads the chosen file as a new version of THAT document, then tells the rep and reloads the card", async () => {
    await clickReplace("grade12.pdf");
    const before = listCalls;
    const file = pdf();
    choose(file);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith({ documentId: "grade12", file }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('"grade12.pdf" replaced')));
    expect(toastSuccess.mock.calls[0][0]).toContain("previous file is kept");
    await waitFor(() => expect(listCalls).toBeGreaterThan(before));
  });

  it("replaces the right row when there are several (it remembers which icon was clicked)", async () => {
    renderCard();
    await screen.findByText("passport.pdf");
    fireEvent.click(within(row("passport.pdf")).getByRole("button", { name: "Replace passport.pdf" }));
    choose(pdf("fresh-passport.pdf"));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    expect(replaceMock.mock.calls[0][0].documentId).toBe("passport");
  });

  it("shows a spinner on that row and disables its Replace icon while the upload runs", async () => {
    let release!: (v: { ok: true }) => void;
    replaceMock.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await clickReplace();
    choose(pdf());
    await waitFor(() => expect(within(row("grade12.pdf")).getByRole("button", { name: "Replace grade12.pdf" })).toBeDisabled());
    release({ ok: true });
    await waitFor(() => expect(within(row("grade12.pdf")).getByRole("button", { name: "Replace grade12.pdf" })).toBeEnabled());
  });

  it("a failed replace shows the reason, leaves the document alone and does not reload", async () => {
    replaceMock.mockResolvedValue({ ok: false, message: "File exceeds the size cap" });
    await clickReplace();
    const before = listCalls;
    choose(pdf());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("File exceeds the size cap"));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(listCalls).toBe(before);
    expect(screen.getByText("grade12.pdf")).toBeInTheDocument();
  });

  it("an unsupported file type is refused up front, with nothing uploaded", async () => {
    await clickReplace();
    choose(new File(["x"], "sheet.xlsx"));
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("sheet.xlsx isn't a supported file type"));
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("cancelling the picker does nothing — and a later pick is not mistaken for the cancelled row", async () => {
    await clickReplace("grade12.pdf");
    fireEvent.change(screen.getByTestId("documents-replace-input"), { target: { files: [] } }); // cancelled
    expect(replaceMock).not.toHaveBeenCalled();
    // pick for a different row afterwards
    fireEvent.click(within(row("passport.pdf")).getByRole("button", { name: "Replace passport.pdf" }));
    choose(pdf("p.pdf"));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledTimes(1));
    expect(replaceMock.mock.calls[0][0].documentId).toBe("passport");
  });
});
