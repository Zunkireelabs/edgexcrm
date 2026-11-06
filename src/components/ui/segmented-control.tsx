"use client"

import * as React from "react"
import { ToggleGroup } from "radix-ui"

import { cn } from "@/lib/utils"

type SegmentedItem = { value: string; label: React.ReactNode; count?: number }

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent"

const ROOT = {
  segmented:
    "inline-flex bg-ds-sunken border border-ds-border rounded-[calc(var(--ds-r-sm)+2px)] p-0.5",
  pills: "flex gap-1.5",
} as const

const ITEM = {
  segmented: cn(
    "whitespace-nowrap px-[11px] py-[5px] rounded-ds-sm text-[12.5px] font-medium text-ds-muted outline-none hover:text-ds-ink",
    "data-[state=on]:bg-ds-surface data-[state=on]:text-ds-ink data-[state=on]:shadow-[var(--ds-shadow-thumb)]",
    FOCUS
  ),
  pills: cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap h-7 px-3 rounded-ds-full border border-ds-border bg-ds-surface text-ds-text text-[12.5px] font-medium outline-none hover:bg-ds-hover",
    "data-[state=on]:bg-ds-ink data-[state=on]:border-ds-ink data-[state=on]:text-white",
    FOCUS
  ),
} as const

const COUNT = {
  segmented: "",
  pills: "text-ds-faint font-medium group-data-[state=on]/seg:text-[#a3a3a3]",
} as const

/**
 * Radix ToggleGroup reports "" when the active item is clicked. A segmented control always has a
 * selection, so that deselect is ignored. Exported for testing.
 */
export function nextSegmentedValue(next: string): string | null {
  return next === "" ? null : next
}

function SegmentedControl({
  value,
  onValueChange,
  items,
  variant = "segmented",
  className,
  "aria-label": ariaLabel,
}: {
  value: string
  onValueChange: (value: string) => void
  items: SegmentedItem[]
  variant?: "segmented" | "pills"
  className?: string
  "aria-label": string
}) {
  return (
    <ToggleGroup.Root
      type="single"
      data-slot="segmented-control"
      data-look="v2"
      data-variant={variant}
      aria-label={ariaLabel}
      value={value}
      onValueChange={(next) => {
        const v = nextSegmentedValue(next)
        if (v !== null) onValueChange(v)
      }}
      className={cn(ROOT[variant], className)}
    >
      {items.map((item) => (
        <ToggleGroup.Item
          key={item.value}
          value={item.value}
          data-look="v2"
          className={cn("group/seg", ITEM[variant])}
        >
          {item.label}
          {item.count !== undefined && <span className={COUNT[variant]}>{item.count}</span>}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

export { SegmentedControl }
export type { SegmentedItem }
