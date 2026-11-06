"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type TableLook = "legacy" | "v2"
const TableLookContext = React.createContext<TableLook>("legacy")

type RowTone = "group" | "total" | "colgroup"

function Table({
  className,
  look = "legacy",
  stickyFirstColumn = false,
  ...props
}: React.ComponentProps<"table"> & {
  /** Design System v2 opt-in. Omitted = today's output, unchanged. */
  look?: TableLook
  /** v2 only: pin the first cell of every row while scrolling horizontally. */
  stickyFirstColumn?: boolean
}) {
  if (look === "v2") {
    return (
      <TableLookContext.Provider value="v2">
        <TableV2 className={className} stickyFirstColumn={stickyFirstColumn} {...props} />
      </TableLookContext.Provider>
    )
  }
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

/** v2 table: bordered scroll container + a right-edge fade shown only while more content is off to the right. */
function TableV2({
  className,
  stickyFirstColumn,
  ...props
}: React.ComponentProps<"table"> & { stickyFirstColumn: boolean }) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [fade, setFade] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)
  const measure = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setFade(el.scrollWidth - el.clientWidth - el.scrollLeft > 2)
    setScrolled(el.scrollLeft > 0)
  }, [])
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const t = el.firstElementChild
    if (t) ro.observe(t)
    return () => ro.disconnect()
  }, [measure])
  return (
    <div data-slot="table-wrapper" data-look="v2" className="relative w-full">
      <div
        ref={scrollRef}
        data-slot="table-container"
        onScroll={measure}
        className="relative w-full overflow-x-auto rounded-ds-md border border-ds-border bg-ds-surface"
      >
        <table
          data-slot="table"
          data-look="v2"
          data-scrolled={stickyFirstColumn && scrolled ? "" : undefined}
          className={cn(
            "w-full border-separate border-spacing-0 text-[13.5px] tabular-nums",
            // 1px edge on the pinned column, only while content is scrolled under it (no gradient).
            stickyFirstColumn &&
              "data-[scrolled]:[&_tr>:first-child]:after:absolute data-[scrolled]:[&_tr>:first-child]:after:inset-y-0 data-[scrolled]:[&_tr>:first-child]:after:right-0 data-[scrolled]:[&_tr>:first-child]:after:w-px data-[scrolled]:[&_tr>:first-child]:after:bg-ds-border data-[scrolled]:[&_tr>:first-child]:after:content-['']",
            stickyFirstColumn &&
              "[&_tr>:first-child]:sticky [&_tr>:first-child]:left-0 [&_tr>:first-child]:z-[1] [&_tr>:first-child]:bg-[var(--row-bg,var(--ds-surface))] [&_thead_tr>:first-child]:z-[3]",
            className
          )}
          {...props}
        />
      </div>
      {fade && (
        <div
          aria-hidden="true"
          data-slot="table-fade"
          className="pointer-events-none absolute top-px right-px bottom-px z-[4] w-9 rounded-r-ds-md bg-linear-to-l from-ds-surface to-white/0"
        />
      )}
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  const v2 = React.useContext(TableLookContext) === "v2"
  return (
    <thead
      data-slot="table-header"
      data-look={v2 ? "v2" : undefined}
      className={cn(v2 ? "[--row-bg:var(--ds-sunken)]" : "[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  const v2 = React.useContext(TableLookContext) === "v2"
  return (
    <tbody
      data-slot="table-body"
      data-look={v2 ? "v2" : undefined}
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({
  className,
  tone,
  flag,
  interactive,
  ...props
}: React.ComponentProps<"tr"> & {
  /** v2 only */
  tone?: RowTone
  /** v2 only: coloured left edge on the first cell */
  flag?: "bad" | "warn"
  /** v2 only: pointer cursor + hover background (rows without it get no hover) */
  interactive?: boolean
}) {
  const v2 = React.useContext(TableLookContext) === "v2"
  if (!v2) {
    return (
      <tr
        data-slot="table-row"
        className={cn(
          "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
          className
        )}
        {...props}
      />
    )
  }
  return (
    <tr
      data-slot="table-row"
      data-look="v2"
      className={cn(
        tone === "group" &&
          "[--row-bg:var(--ds-sunken)] [&>td]:h-[34px] [&>td]:bg-ds-sunken [&>td]:text-ds-muted [&>td]:text-xs [&>td]:leading-[1.5] [&>td]:font-medium [&>td:first-child]:text-ds-text [&>td:first-child]:font-semibold",
        tone === "total" &&
          "[--row-bg:var(--ds-sunken)] [&>td]:h-[42px] [&>td]:bg-ds-sunken [&>td]:font-semibold [&>td]:border-b-0",
        tone === "colgroup" &&
          "[&>th]:h-[26px] [&>th]:pt-1.5 [&>th]:text-[10.5px] [&>th]:tracking-[.06em] [&>th]:uppercase [&>th]:font-medium [&>th]:text-ds-faint [&>th]:text-left [&>th]:border-b-0",
        flag === "bad" && "[&>td:first-child]:shadow-[inset_2px_0_0_var(--ds-bad)]",
        flag === "warn" && "[&>td:first-child]:shadow-[inset_2px_0_0_var(--ds-warn)]",
        interactive &&
          "cursor-pointer hover:bg-ds-hover hover:[--row-bg:var(--ds-hover)]",
        className
      )}
      {...props}
    />
  )
}

function TableHead({
  className,
  numeric,
  divider,
  ...props
}: React.ComponentProps<"th"> & {
  /** v2 only: right-align */
  numeric?: boolean
  /** v2 only: hairline on the left edge (group separator) */
  divider?: boolean
}) {
  const v2 = React.useContext(TableLookContext) === "v2"
  return (
    <th
      data-slot="table-head"
      data-look={v2 ? "v2" : undefined}
      className={cn(
        v2
          ? "sticky top-0 z-[2] h-[34px] px-1.5 bg-ds-sunken border-b border-ds-border text-xs font-medium text-ds-muted text-left whitespace-nowrap"
          : "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        v2 && numeric && "text-right",
        v2 && divider && "shadow-[inset_1px_0_0_var(--ds-divider)] pl-3.5",
        className
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  numeric,
  divider,
  ...props
}: React.ComponentProps<"td"> & {
  /** v2 only: right-align */
  numeric?: boolean
  /** v2 only: hairline on the left edge (group separator) */
  divider?: boolean
}) {
  const v2 = React.useContext(TableLookContext) === "v2"
  return (
    <td
      data-slot="table-cell"
      data-look={v2 ? "v2" : undefined}
      className={cn(
        v2
          ? "h-[50px] px-1.5 py-2 border-b border-ds-divider text-ds-ink whitespace-nowrap text-left"
          : "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        v2 && numeric && "text-right",
        v2 && divider && "shadow-[inset_1px_0_0_var(--ds-divider)] pl-3.5",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
