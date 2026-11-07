import { barPct, fmtValue, STATUS_TONE } from "../lib/format";
import type { StepView } from "../server/load-processes";

/** A step's bar: fill = the live value, tick = the target. Percent metrics only. */
export function StepBar({ step }: { step: StepView }) {
  const pct = barPct(step.value, step.target.unit);
  if (pct === null) return null;
  const tone = STATUS_TONE[step.status];
  return (
    <div className="relative mt-2 h-1.5 w-full rounded-full bg-ds-sunken" role="img" aria-label={`${fmtValue(step.value, step.target.unit)} against a target of ${fmtValue(step.target.value, step.target.unit)}`}>
      <div className={`h-full rounded-full ${tone.bg}`} style={{ width: `${pct}%` }} />
      {step.target.op === ">=" ? <div className="absolute -top-0.5 h-2.5 w-0.5 bg-ds-ink" style={{ left: `${Math.min(100, step.target.value)}%` }} /> : null}
    </div>
  );
}
