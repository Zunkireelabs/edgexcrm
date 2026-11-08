import type { Evidence } from "../changes";
import { fmtN } from "../metrics";
import { NEEDS_BADGES, TURNS_ON, type NeedsBadge, type TurnsOn } from "./memory";
import type { Skipped } from "./propose";

/** Pure view logic for Orca on the Processes screens (EDGEX-109 P4b). No React, no tokens: the colours live in ui/orca.tsx. */

export type DraftSource = "person" | "agent" | "system";

/** What the server knows about an Orca draft beyond its changes. */
export interface OrcaDraftMeta {
  /** New leads in the 30-day window the run read (`evidence.arrived`). */
  arrived: number | null;
  skipped: Skipped[];
}

/** Reads `process_versions.evidence` of an agent draft. Anything unreadable gives an empty, safe meta (the banner then just omits that part). */
export function readOrcaMeta(evidence: unknown): OrcaDraftMeta {
  const e = (evidence ?? {}) as { arrived?: unknown; skipped?: unknown };
  const skipped = Array.isArray(e.skipped)
    ? (e.skipped as unknown[]).flatMap((s) => {
        const o = s as { step?: unknown; reason?: unknown };
        return typeof o?.step === "string" && typeof o?.reason === "string" ? [{ step: o.step, reason: o.reason }] : [];
      })
    : [];
  return { arrived: typeof e.arrived === "number" && Number.isFinite(e.arrived) ? e.arrived : null, skipped };
}

/** "Orca suggests 3 changes for v2" and, when the run counted new leads, "from 131 new leads in 30 days". */
export function bannerText(a: { version: number; changeCount: number; arrived: number | null; windowDays?: number }): { title: string; from: string | null } {
  const n = a.changeCount;
  return {
    title: `Orca suggests ${n} ${n === 1 ? "change" : "changes"} for v${a.version}`,
    from: a.arrived === null ? null : `from ${fmtN(a.arrived)} new ${a.arrived === 1 ? "lead" : "leads"} in ${a.windowDays ?? 30} days`,
  };
}

/** The list page's line: "2 drafts waiting for you" / "Orca, from 30 days of data". Null when no Orca draft is open. */
export function draftsWaiting(drafts: ReadonlyArray<{ source: DraftSource }>): { title: string; sub: string } | null {
  const n = drafts.filter((d) => d.source === "agent").length;
  return n === 0 ? null : { title: `${n} ${n === 1 ? "draft" : "drafts"} waiting for you`, sub: "Orca, from 30 days of data" };
}

export interface SkippedLine {
  key: string;
  /** The step's name ("Call-backs"), falling back to its key. */
  step: string;
  reason: string;
}

export const SKIPPED_SHOWN = 2;

/** "Not changed: {step}: {reason}", at most 2 shown; the rest sit behind a "+N more" toggle. */
export function skippedLines(skipped: readonly Skipped[], stepTitle: (key: string) => string | null): { shown: SkippedLine[]; more: SkippedLine[] } {
  const all = skipped.map((s) => {
    const key = s.step.replace(/^step:/, "");
    return { key, step: stepTitle(key) ?? key, reason: s.reason };
  });
  return { shown: all.slice(0, SKIPPED_SHOWN), more: all.slice(SKIPPED_SHOWN) };
}

export interface WhySegment {
  text: string;
  bold: boolean;
  /** Only ever set for an evidence item that HAS a link: an item without one renders as plain bold text, never a dead link. */
  href?: string;
}

const NUM = /\d[\d,]*(?:\.\d+)?(?:\s?(?:%|hours?\b|h\b|min(?:utes?)?\b|days?\b))?(?:\s+of\s+\d[\d,]*)?/g;

/**
 * Orca's sentence with its numbers in bold, each linked to the evidence that carries it. An evidence value found in the sentence ("17 of 131",
 * "30%") is matched first (longest first); any other number is bold without a link. Evidence the sentence never quotes is returned in `rest`,
 * so every cited item still shows (bold value, linked when it has an href).
 */
export function whySegments(why: string, evidence: readonly Evidence[]): { segments: WhySegment[]; rest: Array<{ label: string; value: string; href?: string }> } {
  const inOrder = evidence
    .map((e, order) => ({ e, order, value: typeof e.value === "string" ? e.value : e.value === null ? "" : String(e.value) }))
    .filter((x) => x.value.length > 0);
  const items = [...inOrder].sort((a, b) => b.value.length - a.value.length);
  const used = new Set<number>();
  type Hit = { start: number; end: number; href?: string };
  const hits: Hit[] = [];
  const taken = (s: number, e: number) => hits.some((h) => s < h.end && e > h.start);

  items.forEach((it, idx) => {
    let from = 0;
    for (;;) {
      const at = why.indexOf(it.value, from);
      if (at < 0) break;
      const end = at + it.value.length;
      // a whole number only: not the tail of a longer one ("7" inside "17")
      const before = why[at - 1];
      const after = why[end];
      if (!taken(at, end) && !(before && /[\d.,]/.test(before)) && !(after && /[\d]/.test(after))) {
        hits.push({ start: at, end, href: it.e.href || undefined });
        used.add(idx);
      }
      from = end;
    }
  });
  for (const m of why.matchAll(NUM)) {
    const start = m.index ?? 0;
    if (!taken(start, start + m[0].length)) hits.push({ start, end: start + m[0].length });
  }
  hits.sort((a, b) => a.start - b.start);

  const segments: WhySegment[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) segments.push({ text: why.slice(cursor, h.start), bold: false });
    segments.push({ text: why.slice(h.start, h.end), bold: true, ...(h.href ? { href: h.href } : {}) });
    cursor = h.end;
  }
  if (cursor < why.length) segments.push({ text: why.slice(cursor), bold: false });

  const rest = items.flatMap((it, idx) => (used.has(idx) ? [] : [{ order: it.order, label: it.e.label, value: it.value, ...(it.e.href ? { href: it.e.href } : {}) }]));
  rest.sort((a, b) => a.order - b.order);
  return { segments, rest: rest.map(({ label, value, href }) => ({ label, value, ...(href ? { href } : {}) })) };
}

/** "needs per-lead SMS · EDGEX-104" (the mockup's chip). */
export function needsText(needs: string): string {
  const label = NEEDS_BADGES[needs as NeedsBadge];
  if (!label) return `needs a feature that is not built yet · ${needs}`;
  return `needs ${label.charAt(0).toLowerCase()}${label.slice(1)} · ${needs}`.replace("needs per-lead sms", "needs per-lead SMS");
}

/** "Turns on: Settings → Smart assignment → Shadow" with the link the owner clicks AFTER approving. Null for an unknown key. */
export function turnsOnInfo(turnsOn: string | null | undefined): { label: string; href: string } | null {
  if (!turnsOn) return null;
  const t = TURNS_ON[turnsOn as TurnsOn];
  return t ? { label: t.label, href: t.href } : null;
}
