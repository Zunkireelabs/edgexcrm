import type { Evidence } from "../changes";

/**
 * The evidence guard's ground truth (EDGEX-109 P4a, decision 6). Every number the Process Improver may write comes from a TOOL, and every
 * tool result carries its numbers as `Fact`s: a stable id, a label, the DISPLAY string exactly as the user will read it ("30%", "3.1 h",
 * "17 of 122"), the raw value, and (when the counted leads can be opened exactly) a leads-list link. The guard is code, not prompt:
 * a sentence or a wording that carries a number no tool produced is dropped before anything is stored.
 */

export interface Fact {
  id: string;
  label: string;
  /** As shown to people. The guard compares THESE strings. */
  display: string;
  raw: number | string | null;
  /** A `/leads?f=...` link that opens exactly the leads this fact counts. Null when the leads list can't express the group. */
  href: string | null;
  stepKey?: string | null;
}

/** The facts one run's tools have produced so far. A run is one model loop; nothing outlives it. */
export class FactStore {
  private readonly byId = new Map<string, Fact>();

  add(fact: Fact): Fact {
    this.byId.set(fact.id, fact);
    return fact;
  }
  addAll(facts: readonly Fact[]): void {
    for (const f of facts) this.add(f);
  }
  get(id: string): Fact | undefined {
    return this.byId.get(id);
  }
  all(): Fact[] {
    return [...this.byId.values()];
  }
  get size(): number {
    return this.byId.size;
  }
}

/** A number as it is written: digits, with an optional unit that makes it a different claim ("30" is not "30%"). */
const NUMBER = /(?<![\w.\-/])(\d[\d,]*(?:\.\d+)?)(?:\s?(%|hours?\b|h\b|min(?:utes?)?\b|days?\b))?/gi;

function unitOf(raw: string | undefined): string {
  if (!raw) return "";
  const u = raw.toLowerCase();
  if (u === "%") return "%";
  if (u.startsWith("h")) return "h";
  if (u.startsWith("m")) return "min";
  return "d";
}

/** Every number in `text`, normalised: "1,234" -> "1234", "3.1 h" -> "3.1h", "30%" -> "30%", "17" -> "17". */
export function numberTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(NUMBER)) out.push(`${m[1].replace(/,/g, "")}${unitOf(m[2])}`);
  return out;
}

export interface NumberCheck {
  ok: boolean;
  /** The numbers the text carries that no tool produced. */
  unknown: string[];
}

/**
 * Every number in `text` must be one of the numbers some fact displays (same value, same unit). A fact's LABEL is the tool's own name for
 * what it counts ("Called within 1 hour"), so the numbers inside a label may be repeated when the model names the measure. `extra` lets the
 * caller allow the numbers it proposes itself (a new target value) and the numbers already written in the text being replaced.
 */
export function checkNumbers(text: string, facts: readonly Fact[], extra: readonly string[] = []): NumberCheck {
  const allowed = new Set<string>(extra);
  for (const f of facts) for (const t of [...numberTokens(f.display), ...numberTokens(f.label)]) allowed.add(t);
  const unknown = [...new Set(numberTokens(text).filter((t) => !allowed.has(t)))];
  return { ok: unknown.length === 0, unknown };
}

/** The evidence the model cited, rebuilt from the run's own facts. The model supplies ids only, never a value or a link. */
export function evidenceFromFacts(ids: readonly string[], store: FactStore): { evidence: Evidence[]; missing: string[] } {
  const evidence: Evidence[] = [];
  const missing: string[] = [];
  for (const id of [...new Set(ids)]) {
    const f = store.get(id);
    if (!f) {
      missing.push(id);
      continue;
    }
    evidence.push({ metric: f.id, label: f.label, value: f.display, stepKey: f.stepKey ?? null, href: f.href });
  }
  return { evidence, missing };
}
