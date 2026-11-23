import { cn } from "@/lib/utils";
import { usageRingTone, type UsageTone } from "@/components/dashboard/usage-ring";

const TONE_STROKE: Record<UsageTone, string> = {
  ink: "stroke-ds-ink",
  warn: "stroke-ds-warn",
  bad: "stroke-ds-bad",
};

/**
 * Circular progress ring (mockup `ring()`): a divider-coloured track plus an arc.
 * `pct === null` draws the track only. Children sit centred inside (initials, a % label).
 * `arcClass` overrides the tone-based arc colour (the AI card uses the violet arc).
 */
export function UsageRing({
  pct,
  size,
  arcClass,
  className,
  children,
}: {
  pct: number | null;
  size: number;
  arcClass?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  const on = pct == null ? 0 : (c * Math.min(100, Math.max(0, pct))) / 100;
  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} aria-hidden className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={2.5} className="stroke-ds-divider" />
        {pct != null && pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={`${on} ${c}`}
            className={arcClass ?? TONE_STROKE[usageRingTone(pct)]}
          />
        )}
      </svg>
      {children}
    </span>
  );
}
