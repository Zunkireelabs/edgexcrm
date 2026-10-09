// @vitest-environment jsdom
//
// Client request (Student Details > Qualification cards): "Attach" instead of "Attach Marksheet", several files at
// once (up to 10), each named / typed, uploaded together. One bad file must never lose or block the others.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, within, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastSuccess, toastError, uploadMock } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn(), uploadMock: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));
vi.mock("@/industries/education-consultancy/features/applicant-documents/upload-document", () => ({ uploadApplicantDocument: uploadMock }));

import { AttachDocumentButton } from "./attach-document-button";

let uuid = 0;
beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  uploadMock.mockReset();
  uuid = 0;
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => `id-${++uuid}` });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pdf = (name: string, lastModified = 1) => new File(["x"], name, { type: "application/pdf", lastModified });
const choose = (...files: File[]) => fireEvent.change(screen.getByTestId("attach-input"), { target: { files } });
const rows = () => within(screen.getByTestId("multi-upload-list")).getAllByText(/\.(pdf|png)$/).map((n) => n.textContent);

function renderButton(over: Partial<Parameters<typeof AttachDocumentButton>[0]> = {}) {
  const onUploaded = vi.fn();
  render(<AttachDocumentButton leadId="lead-1" defaultDocumentType="marksheet" fixedQualificationLevel="see" onUploaded={onUploaded} {...over} />);
  return { onUploaded };
}

describe("the button", () => {
  it("says 'Attach' and accepts several files", () => {
    renderButton();
    expect(screen.getByRole("button", { name: "Attach" })).toBeInTheDocument();
    const input = screen.getByTestId("attach-input");
    expect(input).toHaveAttribute("multiple");
    expect(input.getAttribute("accept")).toContain("application/pdf");
  });

  it("keeps a custom label when one is given (Passport & Citizenship)", () => {
    renderButton({ label: "Attach Passport / ID" });
    expect(screen.getByRole("button", { name: "Attach Passport / ID" })).toBeInTheDocument();
  });

  it("opens no dialog until files are chosen", () => {
    renderButton();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("choosing files", () => {
  it("lists every chosen file, each starting as a Marksheet with that name", async () => {
    renderButton();
    choose(pdf("grade10.pdf"), pdf("grade12.pdf", 2), pdf("transcript.pdf", 3));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(rows()).toEqual(["grade10.pdf", "grade12.pdf", "transcript.pdf"]);
    for (const n of ["grade10.pdf", "grade12.pdf", "transcript.pdf"]) {
      expect(screen.getByRole("combobox", { name: `Type for ${n}` })).toHaveTextContent("Marksheet");
      expect(screen.getByLabelText(`Name for ${n}`)).toHaveValue("Marksheet");
    }
    expect(screen.getByText("3 of 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload 3 files" })).toBeEnabled();
  });

  it("mentions which qualification the files are linked to", async () => {
    renderButton({ fixedQualificationLevel: "see" });
    choose(pdf("a.pdf"));
    expect(await screen.findByText(/SEE \/ Grade X/)).toBeInTheDocument();
  });

  it("takes only the first 10 files and says so", async () => {
    renderButton();
    choose(...Array.from({ length: 13 }, (_, i) => pdf(`f${i}.pdf`, i)));
    await screen.findByRole("dialog");
    expect(rows()).toHaveLength(10);
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("Only 10 files at a time — 3 files were not added."));
    expect(screen.getByText("10 of 10")).toBeInTheDocument();
  });

  it("skips unsupported files with a reason, and keeps the supported ones", async () => {
    renderButton();
    choose(pdf("ok.pdf"), new File(["x"], "sheet.xlsx"));
    await screen.findByRole("dialog");
    expect(rows()).toEqual(["ok.pdf"]);
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("sheet.xlsx isn't a supported file type"));
  });

  it("does not open the dialog at all when nothing chosen is usable", async () => {
    renderButton();
    choose(new File(["x"], "sheet.xlsx"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toastError).toHaveBeenCalled();
  });

  it("lets a file be removed before uploading", async () => {
    renderButton();
    choose(pdf("a.pdf"), pdf("b.pdf", 2));
    fireEvent.click(await screen.findByRole("button", { name: "Remove a.pdf" }));
    expect(rows()).toEqual(["b.pdf"]);
    expect(screen.getByRole("button", { name: "Upload 1 file" })).toBeEnabled();
  });

  it("adds more files from inside the dialog, respecting the cap and skipping duplicates", async () => {
    renderButton();
    choose(pdf("a.pdf"));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByTestId("multi-upload-add-input"), { target: { files: [pdf("a.pdf"), pdf("b.pdf", 2)] } });
    await waitFor(() => expect(rows()).toEqual(["a.pdf", "b.pdf"]));
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("a.pdf was already added."));
  });

  it("disables 'Add more files' once 10 are in", async () => {
    renderButton();
    choose(...Array.from({ length: 10 }, (_, i) => pdf(`f${i}.pdf`, i)));
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: /Add more files/ })).toBeDisabled();
  });

  it("can be cancelled without uploading anything", async () => {
    renderButton();
    choose(pdf("a.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("uploading", () => {
  it("uploads every file, in order, with its own name and type, tagged to the qualification", async () => {
    uploadMock.mockResolvedValue({ ok: true });
    const { onUploaded } = renderButton({ fixedQualificationLevel: "plus_two" });
    choose(pdf("a.pdf"), pdf("b.pdf", 2));
    fireEvent.change(await screen.findByLabelText("Name for b.pdf"), { target: { value: "Grade XII marksheet" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload 2 files" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    expect(uploadMock.mock.calls.map((c) => [c[0].file.name, c[0].name, c[0].documentType, c[0].qualificationLevel, c[0].leadId])).toEqual([
      ["a.pdf", "Marksheet", "marksheet", "plus_two", "lead-1"],
      ["b.pdf", "Grade XII marksheet", "marksheet", "plus_two", "lead-1"],
    ]);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("2 documents uploaded"));
    expect(onUploaded).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sends a blank name as the file's own name — never an empty name", async () => {
    uploadMock.mockResolvedValue({ ok: true });
    renderButton();
    choose(pdf("scan001.pdf"));
    fireEvent.change(await screen.findByLabelText("Name for scan001.pdf"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(uploadMock.mock.calls[0][0].name).toBe("scan001.pdf");
  });

  it("while uploading: inputs and Cancel are locked, and a second click cannot start a second upload", async () => {
    let release!: (v: { ok: true }) => void;
    uploadMock.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    renderButton();
    choose(pdf("a.pdf"));
    const btn = await screen.findByRole("button", { name: "Upload 1 file" });
    // Both clicks land before React redraws (a fast double-click): the button is not yet disabled for the second one.
    act(() => {
      btn.click();
      btn.click();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Uploading…" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove a.pdf" })).toBeDisabled();
    expect(screen.getByLabelText("Name for a.pdf")).toBeDisabled();
    expect(uploadMock).toHaveBeenCalledTimes(1);
    await act(async () => { release({ ok: true }); });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("one failed file does not lose or block the others; the failure stays with its reason", async () => {
    uploadMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, message: "The file was not found in storage" })
      .mockResolvedValueOnce({ ok: true });
    const { onUploaded } = renderButton();
    choose(pdf("a.pdf"), pdf("b.pdf", 2), pdf("c.pdf", 3));
    fireEvent.click(await screen.findByRole("button", { name: "Upload 3 files" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(3)); // c.pdf still uploaded after b.pdf failed
    expect(await screen.findByText(/Not uploaded: The file was not found in storage/)).toBeInTheDocument();
    expect(rows()).toEqual(["b.pdf"]); // the two that saved left the list
    expect(toastError).toHaveBeenCalledWith("2 documents uploaded, 1 failed");
    expect(onUploaded).toHaveBeenCalledTimes(1); // something was saved, so the page refreshes
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // stays open for the retry
    expect(screen.getByRole("button", { name: "Upload 1 file" })).toBeEnabled();
  });

  it("retry uploads ONLY the failed file — nothing is uploaded twice", async () => {
    uploadMock.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, message: "boom" }).mockResolvedValueOnce({ ok: true });
    renderButton();
    choose(pdf("a.pdf"), pdf("b.pdf", 2));
    fireEvent.click(await screen.findByRole("button", { name: "Upload 2 files" }));
    fireEvent.click(await screen.findByRole("button", { name: "Upload 1 file" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(3));
    expect(uploadMock.mock.calls.map((c) => c[0].file.name)).toEqual(["a.pdf", "b.pdf", "b.pdf"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("when everything fails, nothing is saved, the page is not refreshed, and the files stay for a retry", async () => {
    uploadMock.mockResolvedValue({ ok: false, message: "offline" });
    const { onUploaded } = renderButton();
    choose(pdf("a.pdf"), pdf("b.pdf", 2));
    fireEvent.click(await screen.findByRole("button", { name: "Upload 2 files" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("2 documents failed to upload"));
    expect(onUploaded).not.toHaveBeenCalled();
    expect(rows()).toEqual(["a.pdf", "b.pdf"]);
    expect(screen.getAllByText(/Not uploaded: offline/)).toHaveLength(2);
  });

  it("reopens with a clean list after a previous batch", async () => {
    uploadMock.mockResolvedValue({ ok: true });
    renderButton();
    choose(pdf("a.pdf"));
    fireEvent.click(await screen.findByRole("button", { name: "Upload 1 file" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    choose(pdf("z.pdf", 9));
    await screen.findByRole("dialog");
    expect(rows()).toEqual(["z.pdf"]);
  });
});

describe("Passport & Citizenship", () => {
  it("starts files as a Passport, tags no qualification, and offers only identity types", async () => {
    uploadMock.mockResolvedValue({ ok: true });
    renderButton({ defaultDocumentType: "passport", fixedQualificationLevel: undefined, label: "Attach Passport / ID" });
    choose(pdf("passport.pdf"), pdf("citizenship.pdf", 2));
    expect(await screen.findByRole("combobox", { name: "Type for passport.pdf" })).toHaveTextContent("Passport");
    expect(screen.queryByText(/Linked to/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Upload 2 files" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    expect(uploadMock.mock.calls.every((c) => c[0].documentType === "passport" && c[0].qualificationLevel === undefined)).toBe(true);
  });
});
