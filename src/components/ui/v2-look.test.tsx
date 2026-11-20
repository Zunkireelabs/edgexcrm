// @vitest-environment jsdom
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Badge, badgeV2Variants } from "./badge"
import { Button, buttonV2Variants } from "./button"
import { nextSegmentedValue, SegmentedControl } from "./segmented-control"
import { sheetContentClasses } from "./sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table"

afterEach(cleanup)

describe("Button v2", () => {
  it("class strings: every variant x size", () => {
    const out: Record<string, string> = {}
    for (const v of ["primary", "secondary", "ghost", "link", "destructive"] as const)
      for (const s of ["default", "sm", "icon"] as const) out[`${v}/${s}`] = buttonV2Variants({ variant: v, size: s })
    out["defaults"] = buttonV2Variants()
    expect(out).toMatchInlineSnapshot(`
      {
        "defaults": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-ds-surface border-ds-border text-ds-ink hover:bg-ds-hover h-[30px] px-3",
        "destructive/default": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-ds-surface border-ds-border text-ds-bad hover:bg-ds-bad-soft h-[30px] px-3",
        "destructive/icon": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-ds-surface border-ds-border text-ds-bad hover:bg-ds-bad-soft size-9 p-0",
        "destructive/sm": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-ds-surface border-ds-border text-ds-bad hover:bg-ds-bad-soft h-6 px-2",
        "ghost/default": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-transparent border-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink h-[30px] px-3",
        "ghost/icon": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-transparent border-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink size-9 p-0",
        "ghost/sm": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-transparent border-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink h-6 px-2",
        "link/default": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 h-auto border-0 px-0 bg-transparent text-ds-accent hover:underline underline-offset-4 h-[30px] px-3 h-auto px-0",
        "link/icon": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 h-auto border-0 px-0 bg-transparent text-ds-accent hover:underline underline-offset-4 size-9 p-0",
        "link/sm": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 h-auto border-0 px-0 bg-transparent text-ds-accent hover:underline underline-offset-4 h-6 px-2 h-auto px-0",
        "primary/default": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-ds-ink border-ds-ink text-white hover:bg-ds-ink/90 h-[30px] px-3",
        "primary/icon": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-ds-ink border-ds-ink text-white hover:bg-ds-ink/90 size-9 p-0",
        "primary/sm": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-ds-ink border-ds-ink text-white hover:bg-ds-ink/90 h-6 px-2",
        "secondary/default": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-ds-surface border-ds-border text-ds-ink hover:bg-ds-hover h-[30px] px-3",
        "secondary/icon": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-ds-surface border-ds-border text-ds-ink hover:bg-ds-hover size-9 p-0",
        "secondary/sm": "inline-flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-ds-sm border text-[12.5px] font-medium tabular-nums transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ds-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 bg-ds-surface border-ds-border text-ds-ink hover:bg-ds-hover h-6 px-2",
      }
    `)
  })

  it("renders data-look only for v2", () => {
    expect(renderToStaticMarkup(<Button look="v2">x</Button>)).toContain('data-look="v2"')
    expect(renderToStaticMarkup(<Button>x</Button>)).not.toContain("data-look")
  })

  it("wraps a run of text in one truncate span; icons and asChild children are left alone", () => {
    const text = renderToStaticMarkup(<Button look="v2">A long label</Button>)
    expect(text).toContain('<span class="truncate">A long label</span>')
    const mixed = renderToStaticMarkup(<Button look="v2"><svg />Count {3} items</Button>)
    expect(mixed).toContain("<svg></svg><span class=\"truncate\">Count 3 items</span>")
    const slot = renderToStaticMarkup(<Button look="v2" asChild><a href="/x">Go</a></Button>)
    expect(slot).not.toContain("truncate")
    expect(buttonV2Variants()).toContain("min-w-0 max-w-full")
    expect(buttonV2Variants()).toContain("overflow-hidden")
  })

  it("focus ring has an outline style (outline-none alone hides the ring)", () => {
    expect(buttonV2Variants()).toContain("focus-visible:outline-solid")
    expect(buttonV2Variants()).toContain("focus-visible:outline-2")
    const seg = renderToStaticMarkup(
      <SegmentedControl aria-label="x" value="a" onValueChange={() => {}} items={[{ value: "a", label: "A" }]} />
    )
    expect(seg).toContain("focus-visible:outline-solid")
    const pills = renderToStaticMarkup(
      <SegmentedControl aria-label="x" variant="pills" value="a" onValueChange={() => {}} items={[{ value: "a", label: "A" }]} />
    )
    expect(pills).toContain("focus-visible:outline-solid")
  })

  it("rejects legacy names under look=v2 at compile time", () => {
    // @ts-expect-error "outline" is a legacy variant name
    void (<Button look="v2" variant="outline">x</Button>)
    // @ts-expect-error "lg" is a legacy size name
    void (<Button look="v2" size="lg">x</Button>)
    // @ts-expect-error "primary" is a v2-only variant name
    void (<Button variant="primary">x</Button>)
    expect(true).toBe(true)
  })
})

describe("Badge v2", () => {
  it("class strings: the 4 kinds", () => {
    const out: Record<string, string> = {}
    for (const v of ["neutral", "count", "ai", "preview"] as const) out[v] = badgeV2Variants({ variant: v })
    out["defaults"] = badgeV2Variants()
    expect(out).toMatchInlineSnapshot(`
      {
        "ai": "inline-flex items-center gap-1 h-5 px-[7px] rounded-ds-xs bg-[image:var(--ds-ai-tint)] text-ds-ai text-[11px] font-medium [&>svg]:size-[11px]",
        "count": "inline-grid place-items-center min-w-5 h-5 px-1.5 rounded-ds-full bg-ds-bad-soft text-ds-bad text-[11.5px] font-semibold",
        "defaults": "rounded-ds-sm border border-ds-border bg-ds-sunken text-ds-text text-xs px-[9px] py-0.5",
        "neutral": "rounded-ds-sm border border-ds-border bg-ds-sunken text-ds-text text-xs px-[9px] py-0.5",
        "preview": "inline-flex items-center h-5 px-[7px] rounded-ds-xs bg-ds-surface border border-ds-ai-line text-ds-ai text-[11px] font-medium",
      }
    `)
  })

  it("ai renders its Sparkles svg first; others do not", () => {
    const ai = renderToStaticMarkup(<Badge look="v2" variant="ai">Suggested</Badge>)
    expect(ai).toMatch(/<span[^>]*><svg[^>]*aria-hidden="true"/)
    expect(renderToStaticMarkup(<Badge look="v2" variant="neutral">x</Badge>)).not.toContain("<svg")
  })

  it("preview has the default title, overridable", () => {
    expect(renderToStaticMarkup(<Badge look="v2" variant="preview">Preview</Badge>)).toContain(
      "Written from your data by rules. Full AI explanations switch on with Orca"
    )
    expect(renderToStaticMarkup(<Badge look="v2" variant="preview" title="Mine">Preview</Badge>)).toContain('title="Mine"')
  })

  it("rejects legacy names under look=v2 at compile time", () => {
    // @ts-expect-error "secondary" is a legacy variant name
    void (<Badge look="v2" variant="secondary">x</Badge>)
    expect(true).toBe(true)
  })
})

describe("SegmentedControl", () => {
  it("nextSegmentedValue ignores the empty deselect", () => {
    expect(nextSegmentedValue("")).toBeNull()
    expect(nextSegmentedValue("a")).toBe("a")
  })

  it("clicking the active item does nothing; clicking another reports it", () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Window"
        value="a"
        onValueChange={onChange}
        items={[{ value: "a", label: "A" }, { value: "b", label: "B", count: 3 }]}
      />
    )
    fireEvent.click(screen.getByText("A"))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText("B"))
    expect(onChange).toHaveBeenCalledWith("b")
  })
})

describe("Table v2", () => {
  it("v2 sub-part classes and row props", () => {
    const html = renderToStaticMarkup(
      <Table look="v2" stickyFirstColumn>
        <TableHeader>
          <TableRow tone="colgroup"><TableHead divider>G</TableHead></TableRow>
          <TableRow><TableHead numeric>H</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          <TableRow tone="group"><TableCell>g</TableCell></TableRow>
          <TableRow flag="bad" interactive><TableCell numeric divider>1</TableCell></TableRow>
          <TableRow flag="warn"><TableCell>2</TableCell></TableRow>
          <TableRow tone="total"><TableCell>t</TableCell></TableRow>
        </TableBody>
      </Table>
    )
    expect(html).toMatchInlineSnapshot(`"<div data-slot="table-wrapper" data-look="v2" class="relative w-full"><div data-slot="table-container" class="relative w-full overflow-x-auto rounded-ds-md border border-ds-border bg-ds-surface"><table data-slot="table" data-look="v2" class="w-full border-separate border-spacing-0 text-[13.5px] tabular-nums data-[scrolled]:[&amp;_tr&gt;:first-child]:after:absolute data-[scrolled]:[&amp;_tr&gt;:first-child]:after:inset-y-0 data-[scrolled]:[&amp;_tr&gt;:first-child]:after:right-0 data-[scrolled]:[&amp;_tr&gt;:first-child]:after:w-px data-[scrolled]:[&amp;_tr&gt;:first-child]:after:bg-ds-border data-[scrolled]:[&amp;_tr&gt;:first-child]:after:content-[&#x27;&#x27;] [&amp;_tr&gt;:first-child]:sticky [&amp;_tr&gt;:first-child]:left-0 [&amp;_tr&gt;:first-child]:z-[1] [&amp;_tr&gt;:first-child]:bg-[var(--row-bg,var(--ds-surface))] [&amp;_thead_tr&gt;:first-child]:z-[3]"><thead data-slot="table-header" data-look="v2" class="[--row-bg:var(--ds-sunken)]"><tr data-slot="table-row" data-look="v2" class="[&amp;&gt;th]:h-[26px] [&amp;&gt;th]:pt-1.5 [&amp;&gt;th]:text-[10.5px] [&amp;&gt;th]:tracking-[.06em] [&amp;&gt;th]:uppercase [&amp;&gt;th]:font-medium [&amp;&gt;th]:text-ds-faint [&amp;&gt;th]:text-left [&amp;&gt;th]:border-b-0"><th data-slot="table-head" data-look="v2" class="sticky top-0 z-[2] h-[34px] px-1.5 bg-ds-sunken border-b border-ds-border text-xs font-medium text-ds-muted text-left whitespace-nowrap shadow-[inset_1px_0_0_var(--ds-divider)] pl-3.5">G</th></tr><tr data-slot="table-row" data-look="v2" class=""><th data-slot="table-head" data-look="v2" class="sticky top-0 z-[2] h-[34px] px-1.5 bg-ds-sunken border-b border-ds-border text-xs font-medium text-ds-muted whitespace-nowrap text-right">H</th></tr></thead><tbody data-slot="table-body" data-look="v2" class="[&amp;_tr:last-child]:border-0"><tr data-slot="table-row" data-look="v2" class="[--row-bg:var(--ds-sunken)] [&amp;&gt;td]:h-[34px] [&amp;&gt;td]:bg-ds-sunken [&amp;&gt;td]:text-ds-muted [&amp;&gt;td]:text-xs [&amp;&gt;td]:leading-[1.5] [&amp;&gt;td]:font-medium [&amp;&gt;td:first-child]:text-ds-text [&amp;&gt;td:first-child]:font-semibold"><td data-slot="table-cell" data-look="v2" class="h-[50px] px-1.5 py-2 border-b border-ds-divider text-ds-ink whitespace-nowrap text-left">g</td></tr><tr data-slot="table-row" data-look="v2" class="[&amp;&gt;td:first-child]:shadow-[inset_2px_0_0_var(--ds-bad)] cursor-pointer hover:bg-ds-hover hover:[--row-bg:var(--ds-hover)]"><td data-slot="table-cell" data-look="v2" class="h-[50px] px-1.5 py-2 border-b border-ds-divider text-ds-ink whitespace-nowrap text-right shadow-[inset_1px_0_0_var(--ds-divider)] pl-3.5">1</td></tr><tr data-slot="table-row" data-look="v2" class="[&amp;&gt;td:first-child]:shadow-[inset_2px_0_0_var(--ds-warn)]"><td data-slot="table-cell" data-look="v2" class="h-[50px] px-1.5 py-2 border-b border-ds-divider text-ds-ink whitespace-nowrap text-left">2</td></tr><tr data-slot="table-row" data-look="v2" class="[--row-bg:var(--ds-sunken)] [&amp;&gt;td]:h-[42px] [&amp;&gt;td]:bg-ds-sunken [&amp;&gt;td]:font-semibold [&amp;&gt;td]:border-b-0"><td data-slot="table-cell" data-look="v2" class="h-[50px] px-1.5 py-2 border-b border-ds-divider text-ds-ink whitespace-nowrap text-left">t</td></tr></tbody></table></div></div>"`)
  })
})

describe("Sheet v2", () => {
  it("class strings per size", () => {
    expect({
      md: sheetContentClasses("right", "v2", "md"),
      lg: sheetContentClasses("right", "v2", "lg"),
    }).toMatchInlineSnapshot(`
      {
        "lg": "bg-ds-surface data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-0 p-0 shadow-[var(--ds-shadow-float)] transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full border-l w-full sm:max-w-[620px]",
        "md": "bg-ds-surface data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-0 p-0 shadow-[var(--ds-shadow-float)] transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full border-l w-full sm:max-w-[560px]",
      }
    `)
  })
})
