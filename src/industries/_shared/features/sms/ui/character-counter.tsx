"use client";

// The piece users will actually stare at (docs/SMS-PHASE3B-BRIEF.md §3):
//   147/160 · 1 credit · GSM-7        ->  52/70 · 1 credit · Unicode
//
// Segments the FINAL string (prefix + body + footer) through countSegments —
// the same module the server bills from — so this never disagrees with what
// /send actually charges. Recomputes on every render, so it flips to Unicode
// the instant a Devanagari character is typed; no debounce, no network call.

import { countSegments } from "@/lib/sms/segments";

interface CharacterCounterProps {
  body: string;
  prefix: string;
  /** Fully rendered footer text (opt-out link etc.) from the last /preview call. */
  footer: string;
}

export function CharacterCounter({ body, prefix, footer }: CharacterCounterProps) {
  const full = `${prefix}${body}${footer ? `\n${footer}` : ""}`;
  const info = countSegments(full);
  const isUnicode = info.encoding === "unicode";
  const limit = info.segments <= 1 ? (isUnicode ? 70 : 160) : isUnicode ? 67 : 153;
  const usedInSegment = info.segments === 0 ? 0 : limit - info.charsRemaining;

  return (
    <div
      className={`flex items-center gap-2 text-xs font-medium transition-colors ${
        isUnicode ? "text-amber-700" : "text-muted-foreground"
      }`}
    >
      <span className="tabular-nums">
        {usedInSegment}/{limit}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        {info.credits} credit{info.credits === 1 ? "" : "s"}
      </span>
      <span aria-hidden="true">·</span>
      <span
        className={`rounded px-1.5 py-0.5 text-[11px] uppercase tracking-wide ${
          isUnicode ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"
        }`}
      >
        {isUnicode ? "Unicode" : "GSM-7"}
      </span>
      {info.segments > 1 && <span className="text-muted-foreground">({info.segments} segments)</span>}
    </div>
  );
}
