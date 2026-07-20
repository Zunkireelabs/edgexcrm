// Parser routing (docs/ai-native-efforts/working/BRIEF-PHASE-2B-INGESTION.md).
//
// mime -> text, dep-free where possible:
//   text/plain|markdown|csv  -> UTF-8 decode
//   pdf|docx|pptx            -> officeparser
//   image/jpeg|png|webp      -> vision OCR (generateText, MODELS.fast)
//   scanned PDF (<100 chars) -> vision OCR via a PDF file part (OpenAI chat
//                               completions supports application/pdf file
//                               parts as base64 `file_data` — verified against
//                               the installed @ai-sdk/openai build). Wrapped
//                               in try/catch: if the provider/model rejects
//                               it, the caller marks the item failed instead
//                               of retrying forever.
//   link (fetch)              -> dep-free HTML->text (readability upgrade is
//                               a recorded lever, not this slice)
import { generateText } from "ai";
import { parseOffice } from "officeparser";
import { model } from "@/lib/ai/provider";
import type { ParsedDocument } from "./chunker";

const OCR_PROMPT =
  "Transcribe this page faithfully to Markdown. Preserve tables. Output only the transcription — " +
  "raw Markdown, no wrapping ``` code fence, no commentary.";

const SCANNED_PDF_TEXT_THRESHOLD = 100;
const LINK_FETCH_TIMEOUT_MS = 15_000;
const LINK_FETCH_MAX_BYTES = 2 * 1024 * 1024;

export interface OcrUsage {
  inputTokens: number;
  outputTokens: number;
}

/** `ParsedDocument` plus OCR token usage, when the OCR path ran (kb-ingest folds this into the ingestion usage event). */
export interface ParsedResult extends ParsedDocument {
  ocrUsage?: OcrUsage;
}

export class ScannedPdfUnsupportedError extends Error {
  constructor() {
    super("Scanned PDF OCR not supported yet");
  }
}

function totalTextLength(doc: ParsedDocument): number {
  if (doc.pages && doc.pages.length > 0) {
    return doc.pages.reduce((sum, p) => sum + p.text.length, 0);
  }
  return doc.text.length;
}

async function ocrImage(bytes: Uint8Array, mimeType: string): Promise<ParsedResult> {
  const { text, usage } = await generateText({
    model: model("fast"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: OCR_PROMPT },
          { type: "image", image: bytes, mediaType: mimeType },
        ],
      },
    ],
  });
  return { text, ocrUsage: { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 } };
}

async function ocrScannedPdf(bytes: Uint8Array): Promise<ParsedResult> {
  try {
    const { text, usage } = await generateText({
      model: model("fast"),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: OCR_PROMPT },
            { type: "file", data: bytes, mediaType: "application/pdf" },
          ],
        },
      ],
    });
    return { text, ocrUsage: { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 } };
  } catch {
    throw new ScannedPdfUnsupportedError();
  }
}

const OFFICE_FILE_TYPE_HINT: Record<string, "pdf" | "docx" | "pptx"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

async function parseOfficeDocument(bytes: Uint8Array, mimeType: string): Promise<ParsedDocument> {
  // Buffer-only magic-byte auto-detection is unreliable (officeparser's
  // file-type sniffing misses some otherwise-valid PDFs) — we already know
  // the type from the KB item's stored mime_type, so pass it explicitly.
  const ast = await parseOffice(Buffer.from(bytes), { fileType: OFFICE_FILE_TYPE_HINT[mimeType] });

  const pageNodes = ast.content.filter((n): n is typeof n & { type: "page" } => n.type === "page");
  if (pageNodes.length > 0) {
    const pages = pageNodes.map((n, i) => ({
      page: (n.metadata as { pageNumber?: number } | undefined)?.pageNumber ?? i + 1,
      text: n.text ?? "",
    }));
    return { text: ast.toText(), pages };
  }

  return { text: ast.toText() };
}

const TEXT_MIME_TYPES = new Set(["text/plain", "text/markdown", "text/csv"]);
const OFFICE_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Parses uploaded file bytes into text (+ optional page breakdown), routed by mime type. */
export async function parseFileBytes(bytes: Uint8Array, mimeType: string): Promise<ParsedResult> {
  if (TEXT_MIME_TYPES.has(mimeType)) {
    return { text: new TextDecoder("utf-8").decode(bytes) };
  }

  if (IMAGE_MIME_TYPES.has(mimeType)) {
    return ocrImage(bytes, mimeType);
  }

  if (OFFICE_MIME_TYPES.has(mimeType)) {
    const parsed = await parseOfficeDocument(bytes, mimeType);
    if (mimeType === "application/pdf" && totalTextLength(parsed) < SCANNED_PDF_TEXT_THRESHOLD) {
      return ocrScannedPdf(bytes);
    }
    return parsed;
  }

  throw new Error(`Unsupported mime type for parsing: ${mimeType}`);
}

const STRIP_BLOCK_RE = /<(script|style|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi;
const TAG_RE = /<[^>]+>/g;
const WHITESPACE_RE = /[ \t\f\v]+/g;
const BLANK_LINES_RE = /\n\s*\n\s*\n+/g;

const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

/** Dep-free HTML -> text: strips script/style/nav/header/footer blocks, tags, decodes common entities, collapses whitespace. */
export function htmlToText(html: string): string {
  let text = html.replace(STRIP_BLOCK_RE, " ").replace(TAG_RE, " ");
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  for (const [entity, replacement] of Object.entries(HTML_ENTITIES)) {
    text = text.split(entity).join(replacement);
  }
  return text
    .replace(WHITESPACE_RE, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(BLANK_LINES_RE, "\n\n")
    .trim();
}

/** Fetches a link (15s timeout, 2MB cap) and returns dep-free HTML->text. */
export async function parseLink(url: string): Promise<ParsedDocument> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINK_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);

    const reader = res.body?.getReader();
    if (!reader) {
      const html = await res.text();
      return { text: htmlToText(html.slice(0, LINK_FETCH_MAX_BYTES)) };
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < LINK_FETCH_MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
    }
    void reader.cancel().catch(() => {});

    const buffer = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const html = new TextDecoder("utf-8").decode(buffer);
    return { text: htmlToText(html) };
  } finally {
    clearTimeout(timeout);
  }
}
