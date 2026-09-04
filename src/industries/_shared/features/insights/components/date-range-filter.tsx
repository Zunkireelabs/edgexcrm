"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { DATE_RANGE_PRESETS, isDateRangePresetKey } from "../lib/date-range-presets";

/**
 * "From date to now" preset filter for the insights dashboard — the RPC has no
 * p_created_before yet, so a bounded from/to range isn't possible here (see
 * AggregateScope.createdAfter). Reads/writes the `?from=` search param; the page
 * (a Server Component) re-renders with the new range on navigation.
 */
export function DateRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rawFrom = searchParams.get("from") ?? "all";
  const activeKey = isDateRangePresetKey(rawFrom) ? rawFrom : "all";

  function handleSelect(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "all") params.delete("from");
    else params.set("from", key);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-background p-1">
      {DATE_RANGE_PRESETS.map((preset) => {
        const isSelected = preset.key === activeKey;
        return (
          <button
            key={preset.key}
            type="button"
            onClick={() => handleSelect(preset.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              isSelected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
