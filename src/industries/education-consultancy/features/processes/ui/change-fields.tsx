"use client";

import { CaretDownIcon } from "@/components/icons";
import { METRIC_REGISTRY, targetOptionsFor, type MetricUnit } from "../lib/metrics";
import type { ChangeField } from "../lib/changes";
import type { ProcessKey } from "../lib/keys";

/**
 * The inputs for one change, shared by the "Suggest a change" sheet (step 3) and the review page's inline Edit. They hold their value as
 * strings (what an <input> holds) and `toAfter` turns that into the `after` the API takes.
 */
export interface EditState {
  /** target */
  value: string;
  metric: string | null;
  /** wording (exceptions: one per line) */
  text: string;
  /** who */
  slugs: string[];
}

export const EMPTY_EDIT: EditState = { value: "", metric: null, text: "", slugs: [] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A state from an existing value (the live value when suggesting, a change's `after` when editing). */
export function editFromValue(field: ChangeField, part: string, value: unknown): EditState {
  if (field === "target" && isRecord(value) && typeof value.value === "number") {
    return { ...EMPTY_EDIT, value: String(value.value), metric: typeof value.metric === "string" ? value.metric : null };
  }
  if (field === "who" && Array.isArray(value)) return { ...EMPTY_EDIT, slugs: value.filter((x): x is string => typeof x === "string") };
  if (field === "wording") {
    if (part === "exceptions" && Array.isArray(value)) return { ...EMPTY_EDIT, text: value.map(String).join("\n") };
    if (typeof value === "string") return { ...EMPTY_EDIT, text: value };
  }
  return EMPTY_EDIT;
}

/** The API's `after` for this state, or the sentence that says what's missing. */
export function toAfter(field: ChangeField, part: string, st: EditState, options: boolean): { ok: true; after: unknown } | { ok: false; error: string } {
  if (field === "target") {
    const n = Number(st.value);
    if (st.value.trim() === "" || !Number.isFinite(n)) return { ok: false, error: "Enter the target as a number" };
    return { ok: true, after: options && st.metric ? { value: n, metric: st.metric } : { value: n } };
  }
  if (field === "who") return st.slugs.length ? { ok: true, after: st.slugs } : { ok: false, error: "Pick at least one position" };
  if (part === "exceptions") return { ok: true, after: st.text.split("\n").map((l) => l.trim()).filter(Boolean) };
  return st.text.trim() ? { ok: true, after: st.text.trim() } : { ok: false, error: "The wording can't be empty" };
}

const INPUT = "h-8 rounded-ds-sm border border-ds-border bg-ds-surface px-2.5 text-[13px] text-ds-ink outline-none focus-visible:border-ds-accent focus-visible:shadow-[0_0_0_3px_var(--ds-accent-soft)]";
const UNIT_SUFFIX: Record<MetricUnit, string> = { percent: "%", min: "min", count: "" };

export interface ChangeInputsProps {
  field: ChangeField;
  part: string;
  processKey: ProcessKey;
  /** The step the change is on (target options + unit come from it). */
  stepKey: string | null;
  /** The step's current target unit, for a step whose picker has no options. */
  unit: MetricUnit;
  positions: Array<{ slug: string; name: string }>;
  state: EditState;
  onChange: (next: EditState) => void;
  idPrefix: string;
}

export function ChangeInputs({ field, part, processKey, stepKey, unit, positions, state, onChange, idPrefix }: ChangeInputsProps) {
  if (field === "target") {
    const options = stepKey ? targetOptionsFor(processKey, stepKey) : [];
    const metric = state.metric ?? options[0]?.metric ?? null;
    const u = (metric && METRIC_REGISTRY[processKey]?.[metric]?.unit) || unit;
    const chosen = options.find((o) => o.metric === metric);
    return (
      <>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ds-text">
          {options.length > 1 ? (
            <>
              <label htmlFor={`${idPrefix}-metric`}>Counted</label>
              <span className="relative inline-flex">
                <select id={`${idPrefix}-metric`} value={metric ?? ""} onChange={(e) => onChange({ ...state, metric: e.target.value })} className={`${INPUT} appearance-none pr-7`}>
                  {options.map((o) => (
                    <option key={o.metric} value={o.metric}>
                      {o.phrase}
                    </option>
                  ))}
                </select>
                <CaretDownIcon size={14} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ds-muted" />
              </span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <label htmlFor={`${idPrefix}-value`}>Target</label>
          <span className="inline-flex items-center gap-1.5">
            <input
              id={`${idPrefix}-value`}
              inputMode="decimal"
              value={state.value}
              onChange={(e) => onChange({ ...state, value: e.target.value })}
              className={`${INPUT} w-[72px]`}
              aria-label="Target"
            />
            {UNIT_SUFFIX[u] ? <span>{UNIT_SUFFIX[u]}</span> : null}
          </span>
        </div>
        {chosen?.hint ? <div className="text-[12px] text-ds-muted">{chosen.hint}</div> : null}
      </>
    );
  }

  if (field === "who") {
    return (
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
        <legend className="sr-only">Who does it</legend>
        {positions.map((p) => {
          const on = state.slugs.includes(p.slug);
          return (
            <label key={p.slug} className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-ds-text">
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange({ ...state, slugs: on ? state.slugs.filter((s) => s !== p.slug) : [...state.slugs, p.slug] })}
                className="size-4 accent-ds-ink"
              />
              {p.name}
            </label>
          );
        })}
        {positions.length === 0 ? <span className="text-[12.5px] text-ds-muted">No positions set up yet.</span> : null}
      </fieldset>
    );
  }

  return (
    <>
      <textarea
        id={`${idPrefix}-text`}
        aria-label={part === "exceptions" ? "Exceptions, one per line" : "New wording"}
        value={state.text}
        onChange={(e) => onChange({ ...state, text: e.target.value })}
        rows={part === "exceptions" ? 5 : 4}
        className="min-h-[74px] w-full rounded-ds-sm border border-ds-border bg-ds-surface px-[11px] py-[9px] text-[13px] leading-[1.5] text-ds-ink outline-none focus-visible:border-ds-accent focus-visible:shadow-[0_0_0_3px_var(--ds-accent-soft)]"
      />
      {part === "exceptions" ? <div className="text-[12px] text-ds-muted">One exception per line.</div> : null}
    </>
  );
}
