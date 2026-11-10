"use client"

// EDGEX-145 Dialogs v1: ONE searchable dropdown (Popover + the shared cmdk Command), Attio behaviour and look.
// API mirrors how Radix Select is used (value / onValueChange / options). Single or multiple, optional groups,
// optional footer action ("Create …"), search row only for long lists (> 7 options, or `searchable`).
//
// Keyboard: ↑/↓ move the highlight (starts on the selected item, else the first), Enter picks, Esc closes and
// Radix returns focus to the trigger, Tab closes. Roles: trigger = combobox, list = listbox, rows = option.
// z-index: PopoverContent is z-50, rendered after the dialog in the portal order, so it sits above a dialog.

import * as React from "react"
import { CaretDownIcon, CheckIcon } from "@/components/icons"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"

export interface SearchableOption {
  value: string
  label: string
  /** Muted text after the label ("Counsellor · Kathmandu"). Also searched. */
  secondary?: string
  /** 16px leading icon or avatar. */
  icon?: React.ReactNode
  disabled?: boolean
  /** Group heading; options with the same group are listed together, in first-seen order. */
  group?: string
}

export interface SearchableFooterAction {
  label: string
  icon?: React.ReactNode
  onSelect: () => void
}

interface CommonProps {
  options: SearchableOption[]
  placeholder?: string
  searchPlaceholder?: string
  /** Force the search row on (default: only when there are more than 7 options). */
  searchable?: boolean
  footerAction?: SearchableFooterAction
  disabled?: boolean
  id?: string
  className?: string
  "aria-label"?: string
  "aria-invalid"?: boolean
  /** What the trigger shows for the picks (single or multiple). Default: the label, or the labels joined / "N selected" past 2. */
  summarize?: (selected: SearchableOption[]) => string
}

type SingleProps = CommonProps & {
  multiple?: false
  value: string
  onValueChange: (value: string) => void
}
type MultiProps = CommonProps & {
  multiple: true
  value: string[]
  onValueChange: (value: string[]) => void
}
export type SearchableSelectProps = SingleProps | MultiProps

const SEARCH_FROM = 7

export function SearchableSelect(props: SearchableSelectProps) {
  const { options, placeholder = "Select…", searchPlaceholder = "Search…", footerAction, disabled, id, className, summarize } = props
  const multiple = props.multiple === true
  const selectedValues: string[] = multiple ? (props.value as string[]) : props.value ? [props.value as string] : []
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [highlight, setHighlight] = React.useState("")
  const listRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const showSearch = props.searchable ?? options.length > SEARCH_FROM

  const needle = query.trim().toLowerCase()
  const filtered = React.useMemo(
    () =>
      needle
        ? options.filter((o) => o.label.toLowerCase().includes(needle) || (o.secondary ?? "").toLowerCase().includes(needle))
        : options,
    [options, needle],
  )

  const groups = React.useMemo(() => {
    const order: string[] = []
    const byGroup = new Map<string, SearchableOption[]>()
    for (const o of filtered) {
      const g = o.group ?? ""
      if (!byGroup.has(g)) {
        byGroup.set(g, [])
        order.push(g)
      }
      byGroup.get(g)!.push(o)
    }
    return order.map((g) => ({ heading: g, items: byGroup.get(g)! }))
  }, [filtered])

  // Opening: clear the search, start the highlight on the selected item (else the first enabled one).
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setQuery("")
      const sel = options.find((o) => selectedValues.includes(o.value) && !o.disabled)
      setHighlight(sel?.value ?? options.find((o) => !o.disabled)?.value ?? "")
    }
  }
  // Typing: highlight follows the first match.
  React.useEffect(() => {
    if (!open) return
    const first = filtered.find((o) => !o.disabled)
    if (needle && first) setHighlight(first.value)
  }, [needle, open, filtered])

  const pick = (value: string) => {
    if (multiple) {
      const cur = props.value as string[]
      ;(props.onValueChange as (v: string[]) => void)(cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value])
    } else {
      ;(props.onValueChange as (v: string) => void)(value)
      setOpen(false)
    }
  }

  const selectedOptions = selectedValues.map((v) => options.find((o) => o.value === v)).filter((o): o is SearchableOption => !!o)
  let triggerText: React.ReactNode
  if (selectedOptions.length === 0) {
    triggerText = null
  } else if (multiple) {
    triggerText = summarize
      ? summarize(selectedOptions)
      : selectedOptions.length <= 2
        ? selectedOptions.map((o) => o.label).join(", ")
        : `${selectedOptions.length} selected`
  } else if (summarize) {
    triggerText = summarize(selectedOptions)
  } else {
    const o = selectedOptions[0]
    triggerText = (
      <span className="flex min-w-0 items-center gap-2">
        {o.icon}
        <span className="truncate">{o.label}</span>
      </span>
    )
  }
  const listId = React.useId()

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          aria-label={props["aria-label"]}
          aria-invalid={props["aria-invalid"]}
          data-slot="select-trigger"
          data-placeholder={selectedOptions.length === 0 ? "" : undefined}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-[9px] border border-input bg-transparent px-3 text-left text-sm whitespace-nowrap outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&_svg]:shrink-0",
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate">{selectedOptions.length === 0 ? placeholder : triggerText}</span>
          <CaretDownIcon className="size-4 opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) min-w-[200px] overflow-hidden p-0"
        onOpenAutoFocus={(e) => {
          // Without a search input, focus the list root so the arrow keys work.
          if (!showSearch) {
            e.preventDefault()
            listRef.current?.focus()
          }
        }}
        onCloseAutoFocus={(e) => {
          // Esc / pick / Tab: focus always returns to the trigger.
          e.preventDefault()
          triggerRef.current?.focus()
        }}
        onKeyDown={(e) => {
          if (e.key === "Tab") setOpen(false)
        }}
      >
        <Command
          shouldFilter={false}
          value={highlight}
          onValueChange={setHighlight}
          className="bg-transparent"
          ref={listRef as never}
          tabIndex={-1}
        >
          {showSearch && <CommandInput value={query} onValueChange={setQuery} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />}
          <CommandList id={listId} role="listbox" aria-multiselectable={multiple || undefined} className="max-h-[260px] p-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-ds-faint">
                {needle ? `No results for “${query.trim()}”` : "Nothing to choose from"}
              </div>
            ) : (
              groups.map((g) => {
                const rows = g.items.map((o) => {
                  const on = selectedValues.includes(o.value)
                  return (
                    <CommandItem
                      key={o.value}
                      value={o.value}
                      role="option"
                      aria-selected={on}
                      disabled={o.disabled}
                      onSelect={() => pick(o.value)}
                    >
                      {o.icon}
                      <span className="min-w-0 truncate">{o.label}</span>
                      {o.secondary && <span className="shrink-0 text-xs leading-4 font-medium text-black/[.63]">{o.secondary}</span>}
                      <span className="ml-auto flex size-4 shrink-0 items-center justify-center text-ds-muted">
                        {on && <CheckIcon className="size-4" aria-hidden />}
                      </span>
                    </CommandItem>
                  )
                })
                return g.heading ? (
                  <CommandGroup key={g.heading} heading={g.heading} className="p-0">
                    {rows}
                  </CommandGroup>
                ) : (
                  <React.Fragment key="__ungrouped">{rows}</React.Fragment>
                )
              })
            )}
          </CommandList>
          {footerAction && (
            <div className="border-t border-ds-divider p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  footerAction.onSelect()
                }}
                className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-sm leading-5 font-medium text-ds-ink outline-none hover:bg-[#f6f7f7] focus-visible:bg-[#f6f7f7] [&_svg]:size-4 [&_svg]:text-ds-muted"
              >
                {footerAction.icon}
                {footerAction.label}
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
