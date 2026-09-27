"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { DATE_WINDOW_PRESETS, isDateWindowKey } from "../lib/date-window";

/**
 * Team & Lead Performance dashboard's date-window picker — visual clone of
 * DateRangeFilter's pill-button-group, but writes `?window=&from=&to=`
 * (resolveDateWindow's params) instead of DateRangeFilter's `?from=<preset>`.
 * Client components (the self-fetching widgets) read the result via
 * useDateWindow(); router.push re-renders them without a full page reload.
 */
export function DateWindowFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rawKey = searchParams.get("window") ?? "today";
  const activeKey = isDateWindowKey(rawKey) ? rawKey : "today";
  const [customFrom, setCustomFrom] = useState(searchParams.get("from") ?? "");
  const [customTo, setCustomTo] = useState(searchParams.get("to") ?? "");

  function pushParams(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function handleSelect(key: string) {
    if (key === "custom") {
      pushParams({ window: key, from: customFrom || undefined, to: customTo || undefined });
    } else {
      pushParams({ window: key, from: undefined, to: undefined });
    }
  }

  function handleCustomChange(field: "from" | "to", value: string) {
    if (field === "from") setCustomFrom(value);
    else setCustomTo(value);
    const from = field === "from" ? value : customFrom;
    const to = field === "to" ? value : customTo;
    if (from && to) pushParams({ window: "custom", from, to });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-background p-1">
        {DATE_WINDOW_PRESETS.map((preset) => {
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
      {activeKey === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={customFrom}
            onChange={(e) => handleCustomChange("from", e.target.value)}
            className="h-8 w-36"
          />
          <span className="text-muted-foreground text-xs">to</span>
          <Input
            type="date"
            value={customTo}
            onChange={(e) => handleCustomChange("to", e.target.value)}
            className="h-8 w-36"
          />
        </div>
      )}
    </div>
  );
}
