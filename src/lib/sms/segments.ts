// Pure SMS character-counting / segmentation logic. No I/O.
//
// This is the single source of truth for both the Phase 3 on-screen counter and
// the credits we bill against — they must never disagree, so nothing outside
// this file should re-implement any part of this math.
//
// Credits: GSM-7 160 chars = 1 credit (multi-part: 153/segment).
// Unicode  70 chars = 1 credit (multi-part: 67/segment).

export type SmsEncoding = "gsm7" | "unicode";

export interface SegmentInfo {
  encoding: SmsEncoding;
  chars: number;
  segments: number;
  credits: number;
  charsRemaining: number;
}

// GSM 03.38 basic character set (single-width, cost 1).
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

// GSM 03.38 extension table (escape char + these) — each costs 2 characters.
const GSM7_EXTENDED = "^{}\\[~]|€";

const GSM7_BASIC_SET = new Set(GSM7_BASIC.split(""));
const GSM7_EXTENDED_SET = new Set(GSM7_EXTENDED.split(""));

export function detectEncoding(text: string): SmsEncoding {
  for (const ch of text) {
    if (!GSM7_BASIC_SET.has(ch) && !GSM7_EXTENDED_SET.has(ch)) return "unicode";
  }
  return "gsm7";
}

// GSM-7 "character length" counts extension-table chars as 2.
function gsm7Length(text: string): number {
  let len = 0;
  for (const ch of text) len += GSM7_EXTENDED_SET.has(ch) ? 2 : 1;
  return len;
}

export function countSegments(text: string): SegmentInfo {
  const encoding = detectEncoding(text);

  if (encoding === "gsm7") {
    const chars = gsm7Length(text);
    const singleLimit = 160;
    const multiLimit = 153;
    const segments = chars <= singleLimit ? (chars === 0 ? 0 : 1) : Math.ceil(chars / multiLimit);
    const perSegmentLimit = segments <= 1 ? singleLimit : multiLimit;
    const used = segments <= 1 ? chars : chars % multiLimit === 0 ? multiLimit : chars % multiLimit;
    const charsRemaining = segments === 0 ? singleLimit : perSegmentLimit - used;
    return { encoding, chars, segments: Math.max(segments, chars > 0 ? 1 : 0), credits: Math.max(segments, chars > 0 ? 1 : 0), charsRemaining };
  }

  // Unicode / Devanagari path — count actual code points (handles surrogate pairs).
  const chars = Array.from(text).length;
  const singleLimit = 70;
  const multiLimit = 67;
  const segments = chars <= singleLimit ? (chars === 0 ? 0 : 1) : Math.ceil(chars / multiLimit);
  const perSegmentLimit = segments <= 1 ? singleLimit : multiLimit;
  const used = segments <= 1 ? chars : chars % multiLimit === 0 ? multiLimit : chars % multiLimit;
  const charsRemaining = segments === 0 ? singleLimit : perSegmentLimit - used;
  return { encoding, chars, segments: Math.max(segments, chars > 0 ? 1 : 0), credits: Math.max(segments, chars > 0 ? 1 : 0), charsRemaining };
}
