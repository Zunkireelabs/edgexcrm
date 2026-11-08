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
  /** Orca's window in the tenant's days, "9 Oct – 7 Nov" (from `evidence.window`); null when absent or unreadable. */
  windowLabel?: string | null;
}

/** "9 Oct – 7 Nov": Orca's window in the tenant tz. `to` is exclusive (midnight after the last day), so the last day is 1 second earlier. */
export function windowLabel(window: unknown, tz: string): string | null {
  const w = (window ?? {}) as { from?: unknown; to?: unknown };
  if (typeof w.from !== "string" || typeof w.to !== "string") return null;
  const from = Date.parse(w.from);
  const to = Date.parse(w.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short" });
  const a = day(from);
  const b = day(to - 1000);
  return a === b ? a : `${a} – ${b}`;
}

/** Reads `process_versions.evidence` of an agent draft. Anything unreadable gives an empty, safe meta (the banner then just omits that part). */
export function readOrcaMeta(evidence: unknown, tz = "UTC"): OrcaDraftMeta {
  const e = (evidence ?? {}) as { arrived?: unknown; skipped?: unknown; window?: unknown };
  const skipped = Array.isArray(e.skipped)
    ? (e.skipped as unknown[]).flatMap((s) => {
        const o = s as { step?: unknown; reason?: unknown };
        return typeof o?.step === "string" && typeof o?.reason === "string" ? [{ step: o.step, reason: o.reason }] : [];
      })
    : [];
  return { arrived: typeof e.arrived === "number" && Number.isFinite(e.arrived) ? e.arrived : null, skipped, windowLabel: windowLabel(e.window, tz) };
}

/** "Orca suggests 3 changes for v2" and, when the run counted new leads, "from 130 new leads, 9 Oct – 7 Nov" (Orca's own dates, never "30 days"). */
export function bannerText(a: { version: number; changeCount: number; arrived: number | null; windowLabel?: string | null }): { title: string; from: string | null } {
  const n = a.changeCount;
  return {
    title: `Orca suggests ${n} ${n === 1 ? "change" : "changes"} for v${a.version}`,
    from: a.arrived === null ? null : `from ${fmtN(a.arrived)} new ${a.arrived === 1 ? "lead" : "leads"}${a.windowLabel ? `, ${a.windowLabel}` : ""}`,
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

/**
 * Orca's sentence with ONLY the numbers that match an evidence value in bold ("17 of 131", "30%"), longest first, each linked when its evidence
 * has an href. Every other number ("1 working hour", "5 minutes") stays plain. Evidence the sentence never quotes is returned in `rest`
 * with a short lower-case label, for the one muted "Evidence:" line.
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
  hits.sort((a, b) => a.start - b.start);

  const segments: WhySegment[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) segments.push({ text: why.slice(cursor, h.start), bold: false });
    segments.push({ text: why.slice(h.start, h.end), bold: true, ...(h.href ? { href: h.href } : {}) });
    cursor = h.end;
  }
  if (cursor < why.length) segments.push({ text: why.slice(cursor), bold: false });

  const rest = items.flatMap((it, idx) => (used.has(idx) ? [] : [{ order: it.order, label: shortLabel(it.e.label), value: it.value, ...(it.e.href ? { href: it.e.href } : {}) }]));
  rest.sort((a, b) => a.order - b.order);
  return { segments, rest: rest.map(({ label, value, href }) => ({ label, value, ...(href ? { href } : {}) })) };
}

/** "First contact: Contacted within 1 working hour" -> "contacted within 1 working hour": drop the "Step:" prefix, lower-case the first letter (not an acronym). */
export function shortLabel(label: string): string {
  const t = (label.includes(": ") ? label.slice(label.lastIndexOf(": ") + 2) : label).trim();
  return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
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
