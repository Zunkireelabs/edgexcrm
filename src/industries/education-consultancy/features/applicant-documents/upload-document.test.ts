import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadApplicantDocument } from "./upload-document";

const file = () => new File(["hello"], "offer.pdf", { type: "application/pdf" });
const json = (ok: boolean, body: unknown) => ({ ok, json: async () => body });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const PRESIGN = json(true, { data: { document_id: "doc-1", version_id: "ver-1", upload_url: "https://storage.test/put", upload_headers: { "x-h": "1" } } });

describe("uploadApplicantDocument", () => {
  it("presigns, uploads to storage, then completes — in that order, sending the application link", async () => {
    fetchMock.mockResolvedValueOnce(PRESIGN).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(json(true, { data: {} }));
    const r = await uploadApplicantDocument({
      leadId: "lead-1", file: file(), documentType: "conditional_offer", name: "  Arden offer ",
      applicationId: "app-1", applicationNoteId: "note-1",
    });
    expect(r).toEqual({ ok: true });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/leads/lead-1/documents/upload-url",
      "https://storage.test/put",
      "/api/v1/leads/lead-1/documents/doc-1/complete",
    ]);
    const complete = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(complete).toMatchObject({
      version_id: "ver-1", document_type: "conditional_offer", name: "Arden offer",
      original_filename: "offer.pdf", application_id: "app-1", application_note_id: "note-1",
    });
    expect(complete.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("an ordinary upload sends no application link", async () => {
    fetchMock.mockResolvedValueOnce(PRESIGN).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(json(true, { data: {} }));
    await uploadApplicantDocument({ leadId: "lead-1", file: file(), documentType: "passport" });
    const complete = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(complete.application_id).toBeUndefined();
    expect(complete.application_note_id).toBeUndefined();
    expect(complete.name).toBe("offer.pdf"); // falls back to the file name
  });

  it("stops after a failed presign — nothing is uploaded or confirmed", async () => {
    fetchMock.mockResolvedValueOnce(json(false, { error: { message: "File too large" } }));
    expect(await uploadApplicantDocument({ leadId: "l", file: file(), documentType: "other" })).toEqual({ ok: false, message: "File too large" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never calls complete when the storage upload fails", async () => {
    fetchMock.mockResolvedValueOnce(PRESIGN).mockResolvedValueOnce({ ok: false });
    expect(await uploadApplicantDocument({ leadId: "l", file: file(), documentType: "other" })).toEqual({ ok: false, message: "Upload to storage failed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports the server's reason when complete is refused", async () => {
    fetchMock.mockResolvedValueOnce(PRESIGN).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(json(false, { error: { message: "The file was not found in storage" } }));
    expect(await uploadApplicantDocument({ leadId: "l", file: file(), documentType: "other" })).toEqual({ ok: false, message: "The file was not found in storage" });
  });

  it("turns a network error into a clean failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await uploadApplicantDocument({ leadId: "l", file: file(), documentType: "other" })).toEqual({ ok: false, message: "Upload failed" });
  });
});
