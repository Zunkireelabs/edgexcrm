// @vitest-environment jsdom
//
// The CLOSED type dropdown on the grouped list shows the type with its category under it ("Experience Letter" / "Work Experience
// & Gap"), so the filing is visible without reopening the list. Uses the real dropdown (not a stand-in) because what is
// asserted is exactly what the trigger renders.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("./upload-document", () => ({ uploadApplicantDocument: vi.fn() }));

import { MultiDocumentUploadDialog, TypeWithCategory } from "./multi-document-upload-dialog";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/documents/constants";
import { documentTypeLabel } from "./labels";

const pdf = (name: string) => new File(["x"], name, { type: "application/pdf" });

let uuid = 0;
beforeEach(() => {
  uuid = 0;
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => `id-${++uuid}` });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(defaultType: DocumentType, typeOptions: readonly DocumentType[]) {
  render(<MultiDocumentUploadDialog leadId="l1" files={[pdf("a.pdf")]} onClose={() => {}} typeOptions={typeOptions} defaultType={defaultType} nameFrom="file" />);
  return screen.getByRole("combobox", { name: "Type for a.pdf" });
}

describe("the type dropdown's trigger", () => {
  it("shows the type and, under it, the category it is filed under (full list)", () => {
    const trigger = open("experience_letter", DOCUMENT_TYPES);
    expect(trigger).toHaveTextContent("Experience Letter");
    expect(trigger).toHaveTextContent("Work Experience & Gap");
  });

  it("a type named like its category is shown once (Other)", () => {
    const trigger = open("other", DOCUMENT_TYPES);
    expect(trigger.textContent).toBe("Other");
  });

  it("a different type in the same list shows its own category", () => {
    expect(open("passport", DOCUMENT_TYPES)).toHaveTextContent("Personal Identity");
  });

  it("a short list (a Qualification card) shows just the type, as before", () => {
    const trigger = open("marksheet", ["marksheet", "transcript", "certificate", "english_test_result", "other"]);
    expect(trigger.textContent).toBe("Marksheet");
  });

  it("the trigger may grow to two lines on the grouped list only", () => {
    expect(open("passport", DOCUMENT_TYPES).className).toContain("data-[size=default]:h-auto");
    cleanup();
    expect(open("marksheet", ["marksheet", "other"]).className).not.toContain("data-[size=default]:h-auto");
  });
});

describe("TypeWithCategory", () => {
  it("renders the type and its category", () => {
    render(<TypeWithCategory type="gap_explanation" />);
    expect(screen.getByText("Gap Explanation")).toBeInTheDocument();
    expect(screen.getByText("Work Experience & Gap")).toBeInTheDocument();
  });

  it("covers every type: each one renders its own label", () => {
    for (const t of DOCUMENT_TYPES) {
      const { unmount } = render(<TypeWithCategory type={t} />);
      expect(document.body.textContent).toContain(documentTypeLabel(t));
      unmount();
    }
  });
});
