// Shared chunk+retry mechanics for materializing a bulk blast's recipient
// rows (email_messages / sms_messages) — extracted so both channels get the
// same resilience instead of each hand-rolling it slightly differently.
//
// Two real prod incidents motivated this (2026-09-06, Admizz): a 3,114-row
// email blast and an 828-row SMS blast both failed at "Failed to materialize
// recipient rows" with no way to tell why, and no way to resume short of
// clicking Send again from scratch. Chunking alone (the first fix attempted,
// for email only) was not sufficient — it shipped without ever being proven
// against a real multi-thousand-row send, and failed again. This module adds
// the two things chunking alone didn't provide: automatic retry of a single
// failed chunk (most DB/network failures at this scale are transient — a
// pooler recycle, a momentary PostgREST blip — and don't need the whole send
// to restart), and a per-chunk error that identifies exactly which slice of
// the audience failed and why, instead of one generic message for the whole
// call.

export interface ChunkWriteResult {
  error: { message: string; code?: string; details?: string | null; hint?: string | null } | null;
}

export interface MaterializeChunksOptions {
  chunkSize: number;
  /** Retries attempted per chunk before giving up on it. Default 2 (3 total attempts). */
  maxRetriesPerChunk?: number;
  /** Base backoff in ms; doubles each retry (250 -> 500 -> 1000). */
  backoffMs?: number;
  /** Called before each retry — wire to the route's logger. Not called on the final failed attempt. */
  onRetry?: (info: { chunkIndex: number; chunkSize: number; attempt: number; error: ChunkWriteResult["error"] }) => void;
}

export type MaterializeChunksResult =
  | { ok: true }
  | { ok: false; failedChunkIndex: number; failedChunkSize: number; error: ChunkWriteResult["error"] };

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Writes `rows` to the DB in fixed-size chunks via `writeChunk`, retrying an
 * individual chunk (with backoff) on failure before giving up. Stops at the
 * first chunk that exhausts its retries — earlier chunks have already
 * committed, so the caller's own idempotency key (ON CONFLICT DO NOTHING /
 * an app-layer "already materialized" check) makes re-calling this safe: a
 * retried send only re-attempts the rows that never landed.
 */
export async function materializeInChunks<T>(
  rows: T[],
  writeChunk: (chunk: T[]) => Promise<ChunkWriteResult>,
  { chunkSize, maxRetriesPerChunk = 2, backoffMs = 250, onRetry }: MaterializeChunksOptions
): Promise<MaterializeChunksResult> {
  let chunkIndex = 0;
  for (let i = 0; i < rows.length; i += chunkSize, chunkIndex++) {
    const chunk = rows.slice(i, i + chunkSize);
    let lastError: ChunkWriteResult["error"] = null;

    for (let attempt = 0; attempt <= maxRetriesPerChunk; attempt++) {
      const { error } = await writeChunk(chunk);
      if (!error) {
        lastError = null;
        break;
      }
      lastError = error;
      if (attempt < maxRetriesPerChunk) {
        onRetry?.({ chunkIndex, chunkSize: chunk.length, attempt, error });
        await sleep(backoffMs * 2 ** attempt);
      }
    }

    if (lastError) {
      return { ok: false, failedChunkIndex: chunkIndex, failedChunkSize: chunk.length, error: lastError };
    }
  }
  return { ok: true };
}
