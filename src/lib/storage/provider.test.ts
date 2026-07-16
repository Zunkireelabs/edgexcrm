import { describe, it, expect, vi } from "vitest";
import { SupabaseStorageProvider, roundExpiryToHour } from "./provider";

function fakeClient(overrides: Record<string, unknown> = {}) {
  const from = vi.fn(() => ({
    createSignedUploadUrl: vi.fn(async () => ({
      data: { signedUrl: "https://storage.example/signed-upload", token: "upload-token" },
      error: null,
    })),
    createSignedUrl: vi.fn(async () => ({
      data: { signedUrl: "https://storage.example/signed-download" },
      error: null,
    })),
    download: vi.fn(async () => ({
      data: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
      error: null,
    })),
    remove: vi.fn(async () => ({ error: null })),
    ...overrides,
  }));
  return { storage: { from } };
}

describe("roundExpiryToHour", () => {
  it("rounds up to the next hour boundary", () => {
    const now = new Date("2026-07-16T14:23:00.000Z");
    // 60s from now (14:24:00) rounds up to 15:00:00 -> 2220s away.
    expect(roundExpiryToHour(60, now)).toBe(2220);
  });

  it("stays put when the target already lands exactly on an hour boundary", () => {
    const now = new Date("2026-07-16T14:00:00.000Z");
    // exactly 1 hour from now is itself an hour boundary (15:00:00) — no extra rounding.
    expect(roundExpiryToHour(3600, now)).toBe(3600);
  });

  it("enforces the 60s floor", () => {
    const now = new Date("2026-07-16T14:59:59.000Z");
    // 0s from now (14:59:59) rounds up to 15:00:00 -> 1s away, floored to 60.
    expect(roundExpiryToHour(0, now)).toBe(60);
  });
});

describe("SupabaseStorageProvider", () => {
  it("createSignedUploadUrl delegates bucket/path and returns url/token", async () => {
    const client = fakeClient();
    const provider = new SupabaseStorageProvider(async () => client as never);

    const result = await provider.createSignedUploadUrl("knowledge-base-files", "tenant/kb/item.pdf");

    expect(client.storage.from).toHaveBeenCalledWith("knowledge-base-files");
    expect(result).toEqual({ url: "https://storage.example/signed-upload", token: "upload-token" });
  });

  it("getSignedDownloadUrl rounds the expiry before calling createSignedUrl", async () => {
    const createSignedUrl = vi.fn(async () => ({
      data: { signedUrl: "https://storage.example/signed-download" },
      error: null,
    }));
    const client = fakeClient({ createSignedUrl });
    const provider = new SupabaseStorageProvider(async () => client as never);

    const url = await provider.getSignedDownloadUrl("knowledge-base-files", "tenant/kb/item.pdf", 60);

    expect(url).toBe("https://storage.example/signed-download");
    const [, seconds] = createSignedUrl.mock.calls[0];
    expect(seconds).toBeGreaterThan(60);
  });

  it("getBytes converts the downloaded blob to a Uint8Array", async () => {
    const client = fakeClient();
    const provider = new SupabaseStorageProvider(async () => client as never);

    const bytes = await provider.getBytes("knowledge-base-files", "tenant/kb/item.pdf");

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it("remove delegates the bucket and paths", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const client = fakeClient({ remove });
    const provider = new SupabaseStorageProvider(async () => client as never);

    await provider.remove("knowledge-base-files", ["tenant/kb/a.pdf", "tenant/kb/b.pdf"]);

    expect(remove).toHaveBeenCalledWith(["tenant/kb/a.pdf", "tenant/kb/b.pdf"]);
  });

  it("remove is a no-op for an empty path list", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const client = fakeClient({ remove });
    const provider = new SupabaseStorageProvider(async () => client as never);

    await provider.remove("knowledge-base-files", []);

    expect(remove).not.toHaveBeenCalled();
  });

  it("throws when the vendor call returns an error", async () => {
    const client = fakeClient({
      createSignedUploadUrl: vi.fn(async () => ({ data: null, error: { message: "bucket not found" } })),
    });
    const provider = new SupabaseStorageProvider(async () => client as never);

    await expect(provider.createSignedUploadUrl("knowledge-base-files", "x")).rejects.toThrow(
      /bucket not found/
    );
  });
});
