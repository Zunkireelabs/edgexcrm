import { describe, it, expect, vi } from "vitest";
import { materializeInChunks } from "./materialize-chunks";

describe("materializeInChunks", () => {
  it("splits rows into fixed-size chunks and writes every row", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => i);
    const calls: number[][] = [];
    const result = await materializeInChunks(
      rows,
      async (chunk) => {
        calls.push(chunk);
        return { error: null };
      },
      { chunkSize: 100 }
    );

    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it("no-ops on an empty array without calling writeChunk", async () => {
    const writeChunk = vi.fn(async () => ({ error: null }));
    const result = await materializeInChunks([], writeChunk, { chunkSize: 100 });

    expect(result.ok).toBe(true);
    expect(writeChunk).not.toHaveBeenCalled();
  });

  it("retries a failed chunk with backoff, then continues to later chunks on success", async () => {
    const rows = [1, 2, 3, 4];
    let attempts = 0;
    const onRetry = vi.fn();

    const result = await materializeInChunks(
      rows,
      async (chunk) => {
        attempts++;
        // First chunk (rows [1,2]) fails once, then succeeds on retry.
        if (chunk[0] === 1 && attempts === 1) return { error: { message: "transient" } };
        return { error: null };
      },
      { chunkSize: 2, backoffMs: 1, onRetry }
    );

    expect(result.ok).toBe(true);
    expect(attempts).toBe(3); // chunk 1 fails, retries + succeeds (2 attempts), chunk 2 succeeds (1 attempt)
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ chunkIndex: 0, attempt: 0 });
  });

  it("gives up after exhausting retries and reports which chunk failed", async () => {
    const rows = [1, 2, 3, 4];
    const result = await materializeInChunks(rows, async () => ({ error: { message: "permanent", code: "42P10" } }), {
      chunkSize: 2,
      maxRetriesPerChunk: 1,
      backoffMs: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedChunkIndex).toBe(0);
      expect(result.failedChunkSize).toBe(2);
      expect(result.error).toMatchObject({ code: "42P10" });
    }
  });

  it("stops at the first chunk that exhausts retries — never attempts a later chunk", async () => {
    const rows = [1, 2, 3, 4];
    const attemptedChunks: number[][] = [];
    await materializeInChunks(
      rows,
      async (chunk) => {
        attemptedChunks.push(chunk);
        return { error: { message: "permanent" } };
      },
      { chunkSize: 2, maxRetriesPerChunk: 0, backoffMs: 1 }
    );

    expect(attemptedChunks).toEqual([[1, 2]]); // chunk [3,4] never attempted
  });
});
