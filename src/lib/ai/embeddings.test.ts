import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { embedTexts, EMBEDDING_MODEL, EMBEDDING_DIM } from "./embeddings";

function embeddingFor(text: string, dim: number): number[] {
  // Deterministic per-input vector so we can assert order without caring about values.
  const seed = text.length;
  return Array.from({ length: dim }, (_, i) => seed + i);
}

function mockFetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("embedTexts", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it("exports the expected model id and dimension", () => {
    expect(EMBEDDING_MODEL).toBe("text-embedding-3-large");
    expect(EMBEDDING_DIM).toBe(1024);
  });

  it("returns an empty array without calling the vendor for empty input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedTexts([]);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("splits >64 inputs into ordered batches and preserves output order", async () => {
    const texts = Array.from({ length: 70 }, (_, i) => `doc-${i}`);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const parsed = JSON.parse(init.body as string) as { input: string[] };
      const data = parsed.input.map((t, index) => ({ index, embedding: embeddingFor(t, EMBEDDING_DIM) }));
      return mockFetchOnce(200, { data });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedTexts(texts);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBatchSize = JSON.parse(fetchMock.mock.calls[0][1].body as string).input.length;
    const secondBatchSize = JSON.parse(fetchMock.mock.calls[1][1].body as string).input.length;
    expect(firstBatchSize).toBe(64);
    expect(secondBatchSize).toBe(6);

    expect(result).toHaveLength(70);
    result.forEach((vec, i) => {
      expect(vec).toEqual(embeddingFor(texts[i], EMBEDDING_DIM));
    });
  });

  it("reorders a shuffled vendor response back into input order", async () => {
    const texts = ["alpha", "bb", "ccc"];
    const fetchMock = vi.fn(async () =>
      mockFetchOnce(200, {
        data: [
          { index: 2, embedding: [3] },
          { index: 0, embedding: [1] },
          { index: 1, embedding: [2] },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedTexts(texts);

    expect(result).toEqual([[1], [2], [3]]);
  });

  it("retries once on a transient (5xx) failure then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFetchOnce(503, { error: "temporarily unavailable" }))
      .mockResolvedValueOnce(mockFetchOnce(200, { data: [{ index: 0, embedding: [9] }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await embedTexts(["hello"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual([[9]]);
  });

  it("does not retry a non-transient (400) failure", async () => {
    const fetchMock = vi.fn(async () => mockFetchOnce(400, { error: "bad input" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(embedTexts(["hello"])).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
