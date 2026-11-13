import { barPct, fmtValue, STATUS_TONE } from "../lib/format";
import type { StepView } from "../server/load-processes";

/** A step's bar: fill = the live value, tick = the target. Percent metrics only. At 0 a 4px stub still shows, so 0% never looks like "no bar". */
export function StepBar({ step, className = "mt-2" }: { step: StepView; className?: string }) {
  const pct = barPct(step.value, step.target.unit);
  if (pct === null) return null;
  const tone = STATUS_TONE[step.status];
  return (
    <div className={`relative h-1.5 w-full rounded-full bg-ds-sunken ${className}`} role="img" aria-label={`${fmtValue(step.value, step.target.unit)} against a target of ${fmtValue(step.target.value, step.target.unit)}`}>
      <div data-testid="step-bar-fill" className={`h-full rounded-full ${tone.bg}`} style={{ width: `${pct}%`, minWidth: 4 }} />
      {step.target.op === ">=" ? <div className="absolute -top-0.5 h-2.5 w-0.5 bg-ds-ink" style={{ left: `${Math.min(100, step.target.value)}%` }} /> : null}
    </div>
  );
}
