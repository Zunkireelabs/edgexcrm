import { OVERLAP_CHARS } from "@/lib/ai/ingestion/chunker";

export interface DocumentChunk {
  chunkIndex: number;
  content: string;
}

export interface ReconstructResult {
  text: string;
  truncated: boolean;
}

const MAX_CHARS = 20_000;

/**
 * Reassembles a document's full text from its stored (post-overlap) chunks.
 * chunkDocument's applyOverlap (chunker.ts) prepends the tail of each
 * section's PREVIOUS packed piece — before that piece got its own overlap
 * prefix — to every chunk after the first in that section. So the correct
 * un-overlap step compares each chunk's stored content against the tail of
 * the PREVIOUS chunk's already-de-overlapped text, not its raw stored
 * content — done iteratively below. A mismatch (a section/page boundary,
 * where no overlap was ever added, or a legacy pre-overlap row) is expected
 * and handled by keeping that chunk's content whole rather than guessing and
 * corrupting it.
 */
export function reconstructDocument(chunks: DocumentChunk[]): ReconstructResult {
  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const deoverlapped: string[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const { content } = ordered[i];
    if (i === 0) {
      deoverlapped.push(content);
      continue;
    }
    const expectedPrefix = `${deoverlapped[i - 1].slice(-OVERLAP_CHARS)}\n\n`;
    deoverlapped.push(content.startsWith(expectedPrefix) ? content.slice(expectedPrefix.length) : content);
  }

  const full = deoverlapped.join("\n\n");
  if (full.length <= MAX_CHARS) return { text: full, truncated: false };
  return { text: full.slice(0, MAX_CHARS), truncated: true };
}
