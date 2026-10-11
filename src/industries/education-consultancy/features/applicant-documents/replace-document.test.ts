import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { replaceDocumentFile } from "./replace-document";

// The Replace flow must mirror a first upload's safety: presign writes nothing, the file goes straight to storage, and the
// server is only told to switch the document to the new file AFTER the file landed. Any failure leaves the old file in place.

const file = () => new File(["hello"], "new-scan.pdf", { type: "application/pdf" });

interface Call { url: string; method: string; body: unknown }
let calls: Call[];
let responses: Array<{ ok: boolean; json?: unknown }>;

beforeEach(() => {
  calls = [];
  responses = [
    { ok: true, json: { data: { version_id: "v2", upload_url: "https://r2.test/put", upload_headers: { "Content-Type": "application/pdf" } } } },
    { ok: true },
    { ok: true, json: { data: {} } },
  ];
  vi.stubGlobal("crypto", { ...globalThis.crypto, subtle: { digest: async () => new Uint8Array([1, 2, 255]).buffer } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body && typeof init.body === "string" ? JSON.parse(init.body) : init?.body });
    const r = responses.shift() ?? { ok: true, json: {} };
    return { ok: r.ok, json: async () => r.json ?? {} } as Response;
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("replaceDocumentFile", () => {
  it("presigns, uploads straight to storage, then confirms with the checksum — in that order", async () => {
    expect(await replaceDocumentFile({ documentId: "doc-1", file: file() })).toEqual({ ok: true });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/v1/documents/doc-1/versions",
      "PUT https://r2.test/put",
      "POST /api/v1/documents/doc-1/versions/v2/complete",
    ]);
    expect(calls[0].body).toEqual({ original_filename: "new-scan.pdf", file_size: 5, mime_type: "application/pdf" });
    expect(calls[2].body).toEqual({ original_filename: "new-scan.pdf", file_size: 5, mime_type: "application/pdf", checksum: "0102ff" });
  });

  it("never confirms (so never switches the document) when the upload to storage fails", async () => {
    responses[1] = { ok: false };
    expect(await replaceDocumentFile({ documentId: "doc-1", file: file() })).toEqual({ ok: false, message: "Upload to storage failed" });
    expect(calls.some((c) => c.url.includes("/complete"))).toBe(false);
  });

  it("stops at the presign step with the server's reason (e.g. too large, over quota)", async () => {
    responses[0] = { ok: false, json: { error: { message: "File exceeds the size cap" } } };
    expect(await replaceDocumentFile({ documentId: "doc-1", file: file() })).toEqual({ ok: false, message: "File exceeds the size cap" });
    expect(calls).toHaveLength(1); // nothing was uploaded
  });

  it("reports a failed confirmation with the server's reason", async () => {
    responses[2] = { ok: false, json: { error: { message: "The file was not found in storage" } } };
    expect(await replaceDocumentFile({ documentId: "doc-1", file: file() })).toEqual({ ok: false, message: "The file was not found in storage" });
  });

  it("a network error is a plain failure, never a thrown error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await replaceDocumentFile({ documentId: "doc-1", file: file() })).toEqual({ ok: false, message: "Replace failed" });
  });
});
