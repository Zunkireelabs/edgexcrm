// @vitest-environment jsdom
//
// EDGEX-154: the Upload documents dialog. The size hint is the tenant's own setting (read, never hardcoded), and a file
// only counts as uploaded through presign -> storage PUT -> complete (the server's complete route checks storage with
// exists() BEFORE it writes the record: verify before persist).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) } }));

import { MultiDocumentUploadDialog } from "./multi-document-upload-dialog";
import { DOCUMENT_TYPES } from "@/lib/documents/constants";

const MB = 1024 * 1024;
const file = (name: string, size = 10) => { const f = new File(["x"], name, { type: "application/pdf", lastModified: 1 }); Object.defineProperty(f, "size", { value: size }); return f; };

function dialog(props: { files?: File[] | null; maxFileBytes?: number | null } = {}) {
  return render(
    <MultiDocumentUploadDialog leadId="lead-1" files={props.files ?? []} onClose={() => {}} typeOptions={DOCUMENT_TYPES} defaultType="other" nameFrom="file" maxFileBytes={props.maxFileBytes} />,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); toastError.mockClear(); });

describe("drop zone hint reads the tenant's limit", () => {
  it("25 MB tenant: 'PDF, Word, JPG, PNG, WEBP · up to 25 MB each (tenant setting)'", () => {
    dialog({ maxFileBytes: 25 * MB });
    expect(screen.getByText("PDF, Word, JPG, PNG, WEBP · up to 25 MB each (tenant setting)")).toBeInTheDocument();
  });
  it("a different tenant setting changes the text (not hardcoded)", () => {
    dialog({ maxFileBytes: 10 * MB });
    expect(screen.getByText(/up to 10 MB each/)).toBeInTheDocument();
    expect(screen.queryByText(/25 MB/)).toBeNull();
  });
  it("limit unknown (e.g. opened from Student Details): no 'up to' claim at all", () => {
    dialog({ maxFileBytes: null });
    expect(screen.getByText("PDF, Word, JPG, PNG, WEBP")).toBeInTheDocument();
    expect(screen.queryByText(/up to/)).toBeNull();
  });
  it("opens on the drop zone with no files chosen yet", () => {
    dialog({ files: [] });
    expect(screen.getByRole("heading", { name: "Upload documents" })).toBeInTheDocument();
    expect(screen.getByTestId("multi-upload-drop")).toBeInTheDocument();
    expect(screen.queryByTestId("multi-upload-list")).toBeNull();
    expect(screen.getByRole("button", { name: "Upload 0 files" })).toBeDisabled();
  });
  it("a file over the tenant's cap is named and not queued; one under it is", () => {
    dialog({ maxFileBytes: 5 * MB });
    fireEvent.change(screen.getByTestId("multi-upload-add-input"), { target: { files: [file("huge.pdf", 6 * MB), file("ok.pdf", 1 * MB)] } });
    expect(toastError).toHaveBeenCalledWith("huge.pdf is over the 5 MB limit.");
    expect(screen.getByLabelText("Name for ok.pdf")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name for huge.pdf")).toBeNull();
  });
  it("dropping files onto the zone queues them", () => {
    dialog();
    fireEvent.drop(screen.getByTestId("multi-upload-drop"), { dataTransfer: { files: [file("dropped.pdf")] } });
    expect(screen.getByLabelText("Name for dropped.pdf")).toBeInTheDocument();
  });
});

describe("verify before persist (two-system write)", () => {
  const PRESIGN = { ok: true, json: async () => ({ data: { document_id: "doc-1", version_id: "v-1", upload_url: "https://storage.test/put" } }) };

  it("calls the server's complete step only AFTER the storage PUT, and shows a progress bar while it runs", async () => {
    let releasePut!: () => void;
    const putGate = new Promise<void>((r) => { releasePut = r; });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/upload-url")) return PRESIGN;
      if (url === "https://storage.test/put") { await putGate; return { ok: true }; }
      return { ok: true, json: async () => ({ data: {} }) }; // complete
    });
    dialog({ files: [file("a.pdf")] });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));

    const bar = await screen.findByRole("progressbar", { name: "Uploading a.pdf" });
    await waitFor(() => expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0));
    // mid-flight (the PUT hasn't returned): the record-writing call has NOT been made
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/v1/leads/lead-1/documents/upload-url", "https://storage.test/put"]);
    releasePut();
    await waitFor(() => expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/leads/lead-1/documents/upload-url", "https://storage.test/put", "/api/v1/leads/lead-1/documents/doc-1/complete",
    ]));
  });

  it("a failed storage PUT never reaches complete: nothing is recorded and the file stays in the list with its reason", async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith("/upload-url") ? PRESIGN : { ok: false }));
    dialog({ files: [file("a.pdf")] });
    fireEvent.click(screen.getByRole("button", { name: "Upload 1 file" }));
    expect(await screen.findByText("Not uploaded: Upload to storage failed")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/complete"))).toBe(false);
  });
});
