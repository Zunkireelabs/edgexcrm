// @vitest-environment jsdom
//
// MultiDocumentUploadDialog — what the generic Documents card adds on top of the Qualification-card flow: an optional
// "Linked qualification" per file (only for types that can be linked) and files named after themselves.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";

const { toastSuccess, toastError, uploadMock } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn(), uploadMock: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));
vi.mock("./upload-document", () => ({ uploadApplicantDocument: uploadMock }));

// Radix Select needs pointer events jsdom lacks: a native <select> keeps the trigger's aria-label so each file's pickers
// can be found and changed.
vi.mock("@/components/ui/select", () => {
  const SelectTrigger = () => null;
  return {
    Select: ({ value, onValueChange, disabled, children }: { value: string; onValueChange: (v: string) => void; disabled?: boolean; children: React.ReactNode }) => {
      const trigger = React.Children.toArray(children).find((c) => React.isValidElement(c) && c.type === SelectTrigger) as React.ReactElement<Record<string, string>> | undefined;
      return (
        <select aria-label={trigger?.props["aria-label"]} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
          {children}
        </select>
      );
    },
    SelectTrigger,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
  };
});

import { MultiDocumentUploadDialog } from "./multi-document-upload-dialog";
import { DOCUMENT_TYPES } from "@/lib/documents/constants";

const pdf = (name: string, lastModified = 1) => new File(["x"], name, { type: "application/pdf", lastModified });

let uuid = 0;
beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  uploadMock.mockReset().mockResolvedValue({ ok: true });
  uuid = 0;
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => `id-${++uuid}` });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(over: Partial<React.ComponentProps<typeof MultiDocumentUploadDialog>> = {}, files = [pdf("a.pdf"), pdf("b.pdf", 2)]) {
  render(
    <MultiDocumentUploadDialog
      leadId="lead-1"
      files={files}
      onClose={() => {}}
      typeOptions={DOCUMENT_TYPES}
      defaultType="other"
      {...over}
    />
  );
}
const setType = (file: string, type: string) => fireEvent.change(screen.getByLabelText(`Type for ${file}`), { target: { value: type } });
const level = (file: string) => screen.queryByLabelText(`Linked qualification for ${file}`);

describe("linked qualification picker", () => {
  it("is not shown when the picker is off (Qualification / Passport cards), whatever the type", () => {
    open({ defaultType: "marksheet" });
    expect(level("a.pdf")).toBeNull();
  });

  it("is shown per file for a type that can be linked, and not for one that cannot", () => {
    open({ showQualificationLevelPicker: true, nameFrom: "file" });
    expect(level("a.pdf")).toBeNull(); // "Other" cannot be linked
    setType("a.pdf", "marksheet");
    expect(level("a.pdf")).not.toBeNull();
    expect(level("b.pdf")).toBeNull(); // each file decides for itself
    setType("a.pdf", "passport");
    expect(level("a.pdf")).toBeNull();
  });

  it("is replaced by the fixed note when a Qualification card gives its level", () => {
    open({ showQualificationLevelPicker: true, fixedQualificationLevel: "see", defaultType: "marksheet" });
    expect(level("a.pdf")).toBeNull();
    expect(screen.getByText(/SEE \/ Grade X/)).toBeInTheDocument();
  });

  it("sends each file's OWN level, and none for a file that was not linked", async () => {
    open({ showQualificationLevelPicker: true, nameFrom: "file" });
    setType("a.pdf", "marksheet");
    fireEvent.change(level("a.pdf")!, { target: { value: "bachelor" } });
    setType("b.pdf", "transcript"); // linkable but left as "Not linked"
    fireEvent.click(screen.getByRole("button", { name: "Upload 2 files" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2));
    expect(uploadMock.mock.calls.map((c) => [c[0].file.name, c[0].documentType, c[0].qualificationLevel])).toEqual([
      ["a.pdf", "marksheet", "bachelor"],
      ["b.pdf", "transcript", undefined],
    ]);
  });

  it("a level picked and then abandoned by changing to a type that cannot be linked is NOT sent", async () => {
    open({ showQualificationLevelPicker: true, nameFrom: "file" }, [pdf("a.pdf")]);
    setType("a.pdf", "marksheet");
    fireEvent.change(level("a.pdf")!, { target: { value: "masters" } });
    setType("a.pdf", "passport");
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(uploadMock.mock.calls[0][0]).toMatchObject({ documentType: "passport", qualificationLevel: undefined });
  });
});

describe("naming from the file", () => {
  it("each file starts named after itself, with every document type on offer", () => {
    open({ showQualificationLevelPicker: true, nameFrom: "file" });
    expect(screen.getByLabelText("Name for a.pdf")).toHaveValue("a.pdf");
    expect(screen.getByLabelText("Name for b.pdf")).toHaveValue("b.pdf");
    const options = Array.from(screen.getByLabelText("Type for a.pdf").querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(options).toEqual([...DOCUMENT_TYPES]);
  });

  it("uploads with the file's own name and the chosen type, as a single upload on this card always did", async () => {
    open({ showQualificationLevelPicker: true, nameFrom: "file" }, [pdf("passport-scan.pdf")]);
    setType("passport-scan.pdf", "passport");
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(uploadMock.mock.calls[0][0]).toMatchObject({ leadId: "lead-1", documentType: "passport", name: "passport-scan.pdf" });
  });

  it("the default stays the type's label for the Qualification cards", () => {
    open({ defaultType: "marksheet" });
    expect(screen.getByLabelText("Name for a.pdf")).toHaveValue("Marksheet");
  });
});
