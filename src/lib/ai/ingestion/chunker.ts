// Pure chunker (docs/ai-native-efforts/working/BRIEF-PHASE-2B-INGESTION.md).
//
// No tokenizer dependency — token counts are estimated as chars/4, which is
// close enough for a chunk-sizing target (not a billing figure; billing uses
// the vendor's actual usage response).
//
// Recursive split: paragraph -> sentence -> hard cut, greedily packed up to
// ~512 estimated tokens (2048 chars), with ~12% overlap between consecutive
// chunks. Markdown headings start a new "section" (carried into chunk
// metadata); page boundaries (when the parser reports pages) are never
// merged across — each page is chunked independently.

export interface ParsedDocument {
  text: string;
  pages?: { page: number; text: string }[];
}

export interface Chunk {
  content: string;
  page?: number;
  section?: string;
}

const CHARS_PER_TOKEN = 4;
export const TARGET_CHARS = 2048; // ~512 tokens at the chars/4 estimate
// Exported: read-document's chunk-reassembly needs the exact same figure to
// recognize (and strip) the overlap prefix applyOverlap() prepends below.
export const OVERLAP_CHARS = Math.round(TARGET_CHARS * 0.12);

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

const HEADING_RE = /^#{1,6}\s+(.+)$/;

function splitIntoSections(text: string): Array<{ heading?: string; body: string }> {
  const lines = text.split("\n");
  const sections: Array<{ heading?: string; body: string }> = [];
  let currentHeading: string | undefined;
  let currentLines: string[] = [];

  const flush = () => {
    const body = currentLines.join("\n").trim();
    if (body) sections.push({ heading: currentHeading, body });
    currentLines = [];
  };

  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match) {
      flush();
      currentHeading = match[1].trim();
      continue;
    }
    currentLines.push(line);
  }
  flush();

  return sections.length > 0 ? sections : [{ heading: undefined, body: text }];
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Breaks a section body into pieces no larger than TARGET_CHARS: paragraph -> sentence -> hard cut. */
function toPieces(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= TARGET_CHARS) {
      pieces.push(para);
      continue;
    }
    for (const sentence of splitSentences(para)) {
      if (sentence.length <= TARGET_CHARS) {
        pieces.push(sentence);
        continue;
      }
      for (let i = 0; i < sentence.length; i += TARGET_CHARS) {
        pieces.push(sentence.slice(i, i + TARGET_CHARS));
      }
    }
  }
  return pieces;
}

/** Greedily packs pieces up to ~TARGET_CHARS per chunk. */
function packPieces(pieces: string[]): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length > TARGET_CHARS && current) {
      chunks.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Prepends the tail of the previous chunk to each following chunk (~12% overlap). */
function applyOverlap(chunks: string[]): string[] {
  if (chunks.length <= 1) return chunks;
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;
    const prevTail = chunks[i - 1].slice(-OVERLAP_CHARS);
    return `${prevTail}\n\n${chunk}`;
  });
}

function chunkUnit(text: string, page?: number): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of splitIntoSections(text)) {
    const packed = packPieces(toPieces(section.body));
    for (const content of applyOverlap(packed)) {
      chunks.push({
        content,
        ...(page !== undefined ? { page } : {}),
        ...(section.heading ? { section: section.heading } : {}),
      });
    }
  }
  return chunks;
}

export function chunkDocument(doc: ParsedDocument): Chunk[] {
  const units =
    doc.pages && doc.pages.length > 0
      ? doc.pages.map((p) => ({ text: p.text, page: p.page as number | undefined }))
      : [{ text: doc.text, page: undefined as number | undefined }];

  const chunks: Chunk[] = [];
  for (const unit of units) {
    if (!unit.text || !unit.text.trim()) continue;
    chunks.push(...chunkUnit(unit.text, unit.page));
  }
  return chunks;
}
