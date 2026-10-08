import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const ROW = {
  id: "c-1",
  tenant_id: "t-1",
  lead_id: "l-1",
  status: "sent",
  body_snapshot: "Passport: {{passport_number}}\nAddress: {{street_address}}, Nepal",
  template_version: 2,
  signed_at: null,
  link_expires_at: null,
  method: null,
  missing_fields: ["passport_number", "full_address"],
};

const updates: Array<Record<string, unknown>> = [];
let row: Record<string, unknown> = ROW;

function table(name: string) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  q.select = chain;
  q.eq = chain;
  q.is = chain;
  q.update = (patch: Record<string, unknown>) => {
    if (name === "lead_consents") updates.push(patch);
    return q;
  };
  q.single = async () => {
    if (name === "lead_consents") return { data: row, error: null };
    if (name === "consent_templates") return { data: { require_drawn_signature: false, title: "Consent" }, error: null };
    return { data: { name: "Admizz" }, error: null };
  };
  // awaiting an update chain (no .single()) resolves to success
  q.then = (res: (v: unknown) => unknown) => res({ error: null });
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: table,
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "https://x/pdf" } }),
        download: async () => ({ data: null, error: new Error("none") }),
      }),
    },
  }),
}));
vi.mock("@/lib/api/audit", () => ({ emitEvent: async () => {} }));
const pdfMock = vi.fn(async (input: { body: string }) => {
  void input;
  return new Uint8Array([1]);
});
vi.mock("@/lib/consent/pdf", () => ({ generateConsentPdf: (i: { body: string }) => pdfMock(i) }));

function req(body: unknown): NextRequest {
  return { json: async () => body, headers: { get: () => null } } as unknown as NextRequest;
}
const ctx = { params: Promise.resolve({ token: "tok-12345678" }) };
const sign = { agreed: true, signer_name: "Rohit Mehta" };

describe("public consent route — signer-filled details", () => {
  beforeEach(() => {
    updates.length = 0;
    pdfMock.mockClear();
    row = ROW;
  });

  it("GET returns the fields the student should fill in", async () => {
    const { GET } = await import("./route");
    const json = await (await GET({} as NextRequest, ctx)).json();
    expect(json.data.valid).toBe(true);
    expect(json.data.missing_fields).toEqual(["passport_number", "full_address"]);
  });

  it("POST substitutes the typed details into the signed text and stores them", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      req({ ...sign, signer_details: { passport_number: " PA123 ", full_address: "Baneshwor", nationality: "ignored" } }),
      ctx,
    );
    expect(res.status).toBe(200);
    const signed = updates.find((u) => u.status === "signed")!;
    expect(signed.body_snapshot).toBe("Passport: PA123\nAddress: Baneshwor, Nepal");
    expect(signed.signer_details).toEqual({ passport_number: "PA123", full_address: "Baneshwor" });
    expect(pdfMock.mock.calls[0][0].body).toBe("Passport: PA123\nAddress: Baneshwor, Nepal");
  });

  it("POST with nothing typed still signs; blanks are tidied, no raw tags remain", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(sign), ctx);
    expect(res.status).toBe(200);
    const signed = updates.find((u) => u.status === "signed")!;
    expect(signed.body_snapshot).toBe("Passport:\nAddress: Nepal");
  });

  it("POST rejects an invalid detail with 422 and does not sign", async () => {
    row = { ...ROW, missing_fields: ["guardian_email"], body_snapshot: "E: {{guardian_email}}" };
    const { POST } = await import("./route");
    const res = await POST(req({ ...sign, signer_details: { guardian_email: "nope" } }), ctx);
    expect(res.status).toBe(422);
    expect(updates.find((u) => u.status === "signed")).toBeUndefined();
  });

  it("an older consent with no missing fields is signed untouched", async () => {
    row = { ...ROW, missing_fields: [], body_snapshot: "Plain text" };
    const { POST } = await import("./route");
    const res = await POST(req({ ...sign, signer_details: { passport_number: "X" } }), ctx);
    expect(res.status).toBe(200);
    const signed = updates.find((u) => u.status === "signed")!;
    expect(signed).not.toHaveProperty("body_snapshot");
    expect(signed).not.toHaveProperty("signer_details");
  });
});
