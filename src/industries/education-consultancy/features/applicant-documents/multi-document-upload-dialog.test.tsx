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
  const SelectLabel = ({ children, className }: { children: React.ReactNode; className?: string }) => <span data-label-class={className}>{children}</span>;
  const SelectSeparator = () => null;
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
    // a group heading becomes an <optgroup label="...">, which is how a native <select> shows one
    SelectGroup: ({ children }: { children: React.ReactNode }) => {
      const kids = React.Children.toArray(children);
      const label = kids.find((c) => React.isValidElement(c) && c.type === SelectLabel) as React.ReactElement<{ children: string; className?: string }> | undefined;
      const hasSeparator = kids.some((c) => React.isValidElement(c) && c.type === SelectSeparator);
      return (
        <optgroup label={label?.props.children} data-heading-class={label?.props.className} data-separator={hasSeparator ? "true" : undefined}>
          {kids.filter((c) => c !== label && !(React.isValidElement(c) && c.type === SelectSeparator))}
        </optgroup>
      );
    },
    SelectLabel,
    SelectSeparator,
    SelectItem: ({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) => (
      <option value={value} data-item-class={className}>{children}</option>
    ),
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
    expect([...options].sort()).toEqual([...DOCUMENT_TYPES].sort()); // all of them, whatever the arrangement
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

describe("the type dropdown under category headings", () => {
  const headings = (file: string) => Array.from(screen.getByLabelText(`Type for ${file}`).querySelectorAll("optgroup")).map((g) => g.getAttribute("label"));

  it("the full list is grouped under the client's nine headings, in his order, with Other last", () => {
    open({ showQualificationLevelPicker: true, nameFrom: "file" });
    expect(headings("a.pdf")).toEqual([
      "Personal Identity",
      "Academic Records",
      "English Proficiency",
      "Application Essays & References",
      "Work Experience & Gap",
      "Financial Documents",
      "University Offers & Confirmations",
      "Visa & Pre-Departure",
      "Enrollment",
      "Other",
    ]);
  });

  it("each type sits under the right heading", () => {
    open({ showQualificationLevelPicker: true, nameFrom: "file" });
    const group = (label: string) =>
      Array.from(screen.getByLabelText("Type for a.pdf").querySelectorAll(`optgroup[label="${label}"] option`)).map((o) => o.getAttribute("value"));
    expect(group("Work Experience & Gap")).toEqual(["cv", "experience_letter", "gap_explanation"]);
    expect(group("Application Essays & References")).toEqual(["recommendation_letter", "statement_of_purpose"]);
    expect(group("Enrollment")).toEqual(["enrollment_document"]);
  });

  it("choosing a type from a group works as before (it is uploaded as that type)", async () => {
    open({ showQualificationLevelPicker: true, nameFrom: "file" }, [pdf("sop.pdf")]);
    setType("sop.pdf", "statement_of_purpose");
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));
    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(uploadMock.mock.calls[0][0]).toMatchObject({ documentType: "statement_of_purpose" });
  });

  it("a Qualification / Passport card's short list stays flat, with no headings", () => {
    open({ defaultType: "marksheet", typeOptions: ["marksheet", "transcript", "certificate", "english_test_result", "other"] });
    expect(headings("a.pdf")).toEqual([]);
    expect(screen.getByLabelText("Type for a.pdf").querySelectorAll("option")).toHaveLength(5);
  });
});

describe("the grouped dropdown's look", () => {
  const groups = () => Array.from(screen.getByLabelText("Type for a.pdf").querySelectorAll("optgroup"));

  it("headings are small, bold, uppercase and pinned to the top while their group scrolls", () => {
    open({ showQualificationLevelPicker: true, nameFrom: "file" });
    for (const g of groups()) {
      const cls = g.getAttribute("data-heading-class") ?? "";
      for (const part of ["sticky", "top-0", "bg-popover", "font-semibold", "uppercase", "tracking-wider"]) expect(cls, g.getAttribute("label") ?? "").toContain(part);
    }
  });

  it("has a divider between groups — nine of them for ten groups, none before the first", () => {
    open({ showQualificationLevelPicker: true, nameFrom: "file" });
    const all = groups();
    expect(all).toHaveLength(10);
    expect(all[0].getAttribute("data-separator")).toBeNull();
    expect(all.slice(1).every((g) => g.getAttribute("data-separator") === "true")).toBe(true);
  });

  it("types are indented under their heading and the rows are compact", () => {
    open({ showQualificationLevelPicker: true, nameFrom: "file" });
    const items = Array.from(screen.getByLabelText("Type for a.pdf").querySelectorAll("option"));
    expect(items).toHaveLength(DOCUMENT_TYPES.length);
    for (const o of items) {
      expect(o.getAttribute("data-item-class")).toContain("pl-5");
      expect(o.getAttribute("data-item-class")).toContain("py-1");
    }
  });

  it("a short list is untouched: no headings, no dividers, no extra indent", () => {
    open({ defaultType: "marksheet", typeOptions: ["marksheet", "transcript", "certificate", "english_test_result", "other"] });
    const select = screen.getByLabelText("Type for a.pdf");
    expect(select.querySelectorAll("optgroup")).toHaveLength(0);
    for (const o of Array.from(select.querySelectorAll("option"))) expect(o.getAttribute("data-item-class")).toBeNull();
  });
});

