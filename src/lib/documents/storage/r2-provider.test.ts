// Unit tests for R2Provider against a MOCKED S3 client and a mocked
// @aws-sdk/s3-request-presigner — no real network calls, no real R2 bucket.
// R2 credentials are not provisioned yet (docs/APPLICANT-DOCUMENTS-PHASE1-BRIEF.md
// §2) — this file is the entirety of Phase 1's verification for R2Provider.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";

const { getSignedUrlMock } = vi.hoisted(() => ({ getSignedUrlMock: vi.fn() }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

import { R2Provider, readR2ConfigFromEnv } from "./r2-provider";

function fakeClient(sendImpl?: (command: unknown) => unknown) {
  return { send: vi.fn(sendImpl ?? (async () => ({}))) } as unknown as S3Client;
}

beforeEach(() => {
  getSignedUrlMock.mockReset();
});

describe("readR2ConfigFromEnv", () => {
  const KEYS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_ENDPOINT"] as const;
  const originals: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      originals[k] = process.env[k];
      delete process.env[k];
    }
  });

  it("throws a clear error listing every missing env var when none are set", () => {
    expect(() => readR2ConfigFromEnv()).toThrow(/R2_ACCOUNT_ID.*R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY.*R2_BUCKET_NAME.*R2_ENDPOINT/s);
  });

  it("reads all 5 values when every env var is set", () => {
    process.env.R2_ACCOUNT_ID = "acct-1";
    process.env.R2_ACCESS_KEY_ID = "key-1";
    process.env.R2_SECRET_ACCESS_KEY = "secret-1";
    process.env.R2_BUCKET_NAME = "bucket-1";
    process.env.R2_ENDPOINT = "https://acct-1.r2.cloudflarestorage.com";

    const config = readR2ConfigFromEnv();
    expect(config).toEqual({
      accountId: "acct-1",
      accessKeyId: "key-1",
      secretAccessKey: "secret-1",
      bucketName: "bucket-1",
      endpoint: "https://acct-1.r2.cloudflarestorage.com",
    });

    for (const k of KEYS) {
      if (originals[k] !== undefined) process.env[k] = originals[k]!;
      else delete process.env[k];
    }
  });
});

describe("R2Provider", () => {
  it("createSignedUploadUrl issues a PutObjectCommand for the given key/contentType and returns the signed url", async () => {
    getSignedUrlMock.mockResolvedValue("https://r2.example/signed-upload");
    const client = fakeClient();
    const provider = new R2Provider(client, "applicant-documents");

    const result = await provider.createSignedUploadUrl("tenants/t1/applicants/l1/documents/d1/versions/v1/original.pdf", "application/pdf");

    expect(result.url).toBe("https://r2.example/signed-upload");
    expect(result.headers).toEqual({ "Content-Type": "application/pdf" });
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const [signedClient, command, opts] = getSignedUrlMock.mock.calls[0] as unknown as [unknown, { input: Record<string, unknown> }, { expiresIn: number }];
    expect(signedClient).toBe(client);
    expect(command.input).toMatchObject({
      Bucket: "applicant-documents",
      Key: "tenants/t1/applicants/l1/documents/d1/versions/v1/original.pdf",
      ContentType: "application/pdf",
    });
    expect(opts.expiresIn).toBeGreaterThan(0);
  });

  it("createSignedDownloadUrl issues a GetObjectCommand with the requested expiry", async () => {
    getSignedUrlMock.mockResolvedValue("https://r2.example/signed-download");
    const client = fakeClient();
    const provider = new R2Provider(client, "applicant-documents");

    const url = await provider.createSignedDownloadUrl("tenants/t1/.../original.pdf", 600);

    expect(url).toBe("https://r2.example/signed-download");
    const [, command, opts] = getSignedUrlMock.mock.calls[0] as unknown as [unknown, { input: Record<string, unknown> }, { expiresIn: number }];
    expect(command.input).toMatchObject({ Bucket: "applicant-documents", Key: "tenants/t1/.../original.pdf" });
    expect(opts.expiresIn).toBe(600);
  });

  it("getBytes converts the response Body via transformToByteArray", async () => {
    const expectedBytes = new Uint8Array([1, 2, 3]);
    const client = fakeClient(async () => ({
      Body: { transformToByteArray: async () => expectedBytes },
    }));
    const provider = new R2Provider(client, "applicant-documents");

    const bytes = await provider.getBytes("tenants/t1/.../original.pdf");

    expect(bytes).toBe(expectedBytes);
  });

  it("getBytes throws when the response has no Body", async () => {
    const client = fakeClient(async () => ({}));
    const provider = new R2Provider(client, "applicant-documents");

    await expect(provider.getBytes("missing-key")).rejects.toThrow(/empty response body/);
  });

  it("remove sends a DeleteObjectsCommand for all keys", async () => {
    const send = vi.fn(async () => ({}));
    const client = { send } as unknown as S3Client;
    const provider = new R2Provider(client, "applicant-documents");

    await provider.remove(["a.pdf", "b.pdf"]);

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as unknown as { input: { Delete: { Objects: { Key: string }[] } } };
    expect(command.input.Delete.Objects).toEqual([{ Key: "a.pdf" }, { Key: "b.pdf" }]);
  });

  it("remove is a no-op for an empty key list", async () => {
    const send = vi.fn(async () => ({}));
    const client = { send } as unknown as S3Client;
    const provider = new R2Provider(client, "applicant-documents");

    await provider.remove([]);

    expect(send).not.toHaveBeenCalled();
  });

  it("remove throws when the vendor reports per-key errors", async () => {
    const client = fakeClient(async () => ({ Errors: [{ Key: "a.pdf", Message: "AccessDenied" }] }));
    const provider = new R2Provider(client, "applicant-documents");

    await expect(provider.remove(["a.pdf"])).rejects.toThrow(/a\.pdf.*AccessDenied/);
  });

  it("copy sends a CopyObjectCommand with a URL-encoded CopySource", async () => {
    const send = vi.fn(async () => ({}));
    const client = { send } as unknown as S3Client;
    const provider = new R2Provider(client, "applicant-documents");

    await provider.copy("versions/v1/original.pdf", "versions/v2/original.pdf");

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0] as unknown as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      Bucket: "applicant-documents",
      Key: "versions/v2/original.pdf",
      CopySource: "applicant-documents/versions%2Fv1%2Foriginal.pdf",
    });
  });
});
