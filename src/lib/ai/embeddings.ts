// Embeddings client seam (docs/ai-native-efforts/working/BRIEF-PHASE-2A-STORAGE-SEAM-SCHEMA.md).
//
// Vendor call is isolated in this one module — swapping to Voyage (or any
// other embeddings provider) means changing only what's below this line.
// `EMBEDDING_MODEL`/`EMBEDDING_DIM` also get stamped onto every
// `knowledge_chunks` row (migration 169) so a future re-embed is a clean
// "rows with a different embedding_model" query, not a guess.

export const EMBEDDING_MODEL = "text-embedding-3-large";
export const EMBEDDING_DIM = 1024;

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const BATCH_SIZE = 64;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

class EmbeddingsRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function callOpenAIEmbeddings(texts: string[]): Promise<Array<{ index: number; embedding: number[] }>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIM,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new EmbeddingsRequestError(`OpenAI embeddings request failed (${res.status}): ${body}`, res.status);
  }

  const json = (await res.json()) as { data: Array<{ index: number; embedding: number[] }> };
  return json.data;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  let data: Array<{ index: number; embedding: number[] }>;
  try {
    data = await callOpenAIEmbeddings(texts);
  } catch (err) {
    // Retry once — on a network failure (no status) or a transient vendor
    // status. Anything else (e.g. a 400 for bad input) isn't worth retrying.
    const status = err instanceof EmbeddingsRequestError ? err.status : undefined;
    if (status !== undefined && !RETRYABLE_STATUS.has(status)) throw err;
    data = await callOpenAIEmbeddings(texts);
  }

  return [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Embeds `texts` in order, batching ≤64 inputs per vendor call. Output order matches input order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    batches.push(texts.slice(i, i + BATCH_SIZE));
  }

  const results: number[][] = [];
  for (const batch of batches) {
    results.push(...(await embedBatch(batch)));
  }
  return results;
}
