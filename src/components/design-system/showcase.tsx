"use client"

import { useState } from "react"
import { ArrowRightIcon, PlusIcon, XIcon } from "@phosphor-icons/react";

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const COLORS: Array<[string, string]> = [
  ["canvas", "#f6f6f5"], ["surface", "#ffffff"], ["sunken", "#fafaf9"], ["hover", "#f4f4f3"], ["selected", "#efefee"],
  ["border", "#e8e8e6"], ["divider", "#f0f0ee"], ["ink", "#141414"], ["text", "#3a3a38"], ["muted", "#73736f"],
  ["faint", "#a3a39e"], ["ghost", "#d6d6d2"], ["accent", "#2272B4"], ["accent-soft", "#eaf2fa"],
  ["good", "#127a4a"], ["good-soft", "#e9f6ef"], ["bad", "#b42318"], ["bad-soft", "#fdeeec"],
  ["warn", "#a15c07"], ["warn-soft", "#fdf3e3"], ["ai", "#5b47d6"], ["ai-soft", "#f3f1fd"], ["ai-line", "#d9d3fa"],
]

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section data-testid={id} className="mt-10">
      <h2 className="ds-label mb-3">{title}</h2>
      {children}
    </section>
  )
}

const WIDE_COLS = Array.from({ length: 14 }, (_, i) => `Col ${i + 1}`)

export function Showcase() {
  const [seg, setSeg] = useState("role")
  const [pill, setPill] = useState("all")
  const [sheet, setSheet] = useState<"md" | "lg" | null>(null)
  const items = [{ value: "role", label: "By role" }, { value: "branch", label: "By branch" }, { value: "none", label: "Everyone" }]
  const pills = [{ value: "all", label: "All", count: 12 }, { value: "bad", label: "Needs action", count: 4 }, { value: "good", label: "Going well", count: 8 }]
  const longItems = [{ value: "a", label: "A very long segment label that keeps going" }, { value: "b", label: "Short" }]

  return (
    <div className="text-ds-text">
      <h1 className="text-ds-title text-ds-ink">Design System v2</h1>
      <p className="text-ds-lede text-ds-muted mt-1">Dev-only showcase. Each primitive opts in with look=&quot;v2&quot;.</p>

      <Section id="ds-colors" title="Colour">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {COLORS.map(([n, v]) => (
            <div key={n} className="rounded-ds-sm border border-ds-border bg-ds-surface p-2">
              <div className="h-10 rounded-ds-xs border border-ds-divider" style={{ background: `var(--ds-${n})` }} />
              <div className="text-ds-meta text-ds-ink mt-1">ds-{n}</div>
              <div className="text-ds-meta text-ds-faint">{v}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="ds-type" title="Type scale">
        <div className="space-y-2 rounded-ds-md border border-ds-border bg-ds-surface p-4">
          <div className="text-ds-title text-ds-ink">Title 26 / 600</div>
          <div className="text-ds-section text-ds-ink">Section 15 / 600</div>
          <div className="text-ds-lede text-ds-muted">Lede 14 / 400</div>
          <div className="text-ds-body">Body 13.5 / 400</div>
          <div className="text-ds-meta text-ds-muted">Meta 12.5 / 400</div>
          <div className="text-ds-metric text-ds-ink">1,248</div>
          <div className="ds-label">Label 11 / 500 caps</div>
        </div>
      </Section>

      <Section id="ds-radius" title="Radius scale">
        <div className="flex flex-wrap gap-4">
          {([["xs", "rounded-ds-xs"], ["sm", "rounded-ds-sm"], ["md", "rounded-ds-md"], ["lg", "rounded-ds-lg"], ["full", "rounded-ds-full"]] as const).map(([r, cls]) => (
            <div key={r} className={`${cls} border border-ds-border bg-ds-surface grid h-16 w-24 place-items-center text-ds-meta`}>{r}</div>
          ))}
        </div>
      </Section>

      <Section id="ds-buttons" title="Button — legacy beside v2">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="default">Legacy default</Button>
            <Button variant="outline">Legacy outline</Button>
            <Button variant="ghost">Legacy ghost</Button>
          </div>
          {(["primary", "secondary", "ghost", "link", "destructive"] as const).map((v) => (
            <div key={v} className="flex flex-wrap items-center gap-2">
              <span className="ds-label w-24">{v}</span>
              <Button look="v2" variant={v}>{v}</Button>
              <Button look="v2" variant={v} size="sm">{v} sm</Button>
              <Button look="v2" variant={v} size="icon" aria-label="Close"><XIcon /></Button>
              <Button look="v2" variant={v} disabled>disabled</Button>
              <Button look="v2" variant={v}><PlusIcon />With icon</Button>
              {v === "link" && <Button look="v2" variant="link">Open <ArrowRightIcon className="size-3.5" /></Button>}
            </div>
          ))}
          <div className="w-[200px] rounded-ds-sm border border-dashed border-ds-border p-2">
            <Button look="v2" variant="primary" className="max-w-full overflow-hidden text-ellipsis">A very long button label that must not break out</Button>
          </div>
        </div>
      </Section>

      <Section id="ds-badges" title="Badge — legacy beside v2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>default</Badge><Badge variant="secondary">secondary</Badge><Badge variant="outline">outline</Badge><Badge variant="destructive">destructive</Badge>
          <span className="mx-2 h-4 w-px bg-ds-border" />
          <Badge look="v2" variant="neutral">neutral</Badge>
          <Badge look="v2" variant="count">4</Badge>
          <Badge look="v2" variant="ai">Suggested</Badge>
          <Badge look="v2" variant="preview">Preview</Badge>
        </div>
      </Section>

      <Section id="ds-segmented" title="Segmented control">
        <div className="space-y-4">
          <SegmentedControl aria-label="Group" value={seg} onValueChange={setSeg} items={items} />
          <SegmentedControl aria-label="Filter" variant="pills" value={pill} onValueChange={setPill} items={pills} />
          <div className="w-[260px]"><SegmentedControl aria-label="Long" value="a" onValueChange={() => {}} items={longItems} /></div>
        </div>
      </Section>

      <Section id="ds-table" title="Table v2">
        <Table look="v2">
          <TableHeader>
            <TableRow tone="colgroup"><TableHead /><TableHead divider colSpan={2}>Intake</TableHead><TableHead divider>Results</TableHead></TableRow>
            <TableRow><TableHead>Person</TableHead><TableHead numeric>Received</TableHead><TableHead numeric>Calls</TableHead><TableHead numeric divider>Filed</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow tone="group"><TableCell>Counsellors</TableCell><TableCell numeric>40</TableCell><TableCell numeric>9</TableCell><TableCell numeric divider>2</TableCell></TableRow>
            <TableRow><TableCell>Normal row</TableCell><TableCell numeric>12</TableCell><TableCell numeric>3</TableCell><TableCell numeric divider>1</TableCell></TableRow>
            <TableRow flag="bad"><TableCell>Flagged bad</TableCell><TableCell numeric>0</TableCell><TableCell numeric><span className="text-ds-ghost">0</span></TableCell><TableCell numeric divider><span className="text-ds-ghost">–</span></TableCell></TableRow>
            <TableRow flag="warn"><TableCell>Flagged warn</TableCell><TableCell numeric>31</TableCell><TableCell numeric>7</TableCell><TableCell numeric divider>0</TableCell></TableRow>
            <TableRow interactive><TableCell>Interactive row</TableCell><TableCell numeric>8</TableCell><TableCell numeric>2</TableCell><TableCell numeric divider>1</TableCell></TableRow>
            <TableRow tone="total"><TableCell>Team total</TableCell><TableCell numeric>91</TableCell><TableCell numeric>21</TableCell><TableCell numeric divider>4</TableCell></TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section id="ds-table-wide" title="Table v2 — wide, sticky first column, edge fade">
        <div className="w-[700px] max-w-full">
          <Table look="v2" stickyFirstColumn className="min-w-[1100px]">
            <TableHeader>
              <TableRow><TableHead>Person</TableHead>{WIDE_COLS.map((c) => <TableHead key={c} numeric>{c}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {["Asha", "Bikram", "Chandra"].map((n, r) => (
                <TableRow key={n}><TableCell>{n}</TableCell>{WIDE_COLS.map((c, i) => <TableCell key={c} numeric>{(r + 1) * (i + 2)}</TableCell>)}</TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section id="ds-sheet" title="Sheet v2">
        <div className="flex gap-2">
          <Button look="v2" onClick={() => setSheet("md")}>Open md (560)</Button>
          <Button look="v2" onClick={() => setSheet("lg")}>Open lg (620)</Button>
        </div>
        <Sheet open={sheet !== null} onOpenChange={(o) => !o && setSheet(null)}>
          <SheetContent look="v2" size={sheet ?? "md"} className="overflow-y-auto">
            <SheetHeader className="p-6">
              <SheetTitle className="text-ds-section text-ds-ink">Sheet {sheet}</SheetTitle>
              <SheetDescription>Header, tile strip and list.</SheetDescription>
            </SheetHeader>
            <div className="mx-6 grid grid-cols-4 rounded-ds-md border border-ds-border">
              {["Received", "Calls", "Filed", "Moved"].map((l, i) => (
                <div key={l} className={`p-3 ${i ? "border-l border-ds-divider" : ""}`}>
                  <div className="text-ds-meta text-ds-muted">{l}</div>
                  <div className="text-ds-metric text-ds-ink">{(i + 1) * 7}</div>
                </div>
              ))}
            </div>
            <ul className="mx-6 mt-4 border-t border-ds-divider">
              {Array.from({ length: 6 }, (_, i) => <li key={i} className="border-b border-ds-divider py-3 text-ds-body">List item {i + 1}</li>)}
            </ul>
          </SheetContent>
        </Sheet>
      </Section>

      <Section id="ds-canvas" title="On canvas">
        <div className="rounded-ds-md bg-ds-canvas p-4">
          <div className="mb-3 flex gap-2">
            <Button look="v2" variant="primary">Primary</Button>
            <Button look="v2" variant="secondary">Secondary</Button>
            <Button look="v2" variant="ghost">Ghost</Button>
          </div>
          <Table look="v2">
            <TableHeader><TableRow><TableHead>Person</TableHead><TableHead numeric>Received</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow tone="group"><TableCell>Counsellors</TableCell><TableCell numeric>40</TableCell></TableRow>
              <TableRow><TableCell>Asha</TableCell><TableCell numeric>12</TableCell></TableRow>
              <TableRow tone="total"><TableCell>Team total</TableCell><TableCell numeric>52</TableCell></TableRow>
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section id="ds-ai" title="AI only">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-ds-lg border border-ds-ai-line p-4 text-ds-body" style={{ background: "var(--ds-ai-wash)" }}>ai-wash</div>
          <div className="rounded-ds-md p-4 text-ds-body" style={{ background: "var(--ds-ai-block)" }}>ai-block</div>
          <div className="rounded-ds-xs p-4 text-ds-body text-ds-ai" style={{ background: "var(--ds-ai-tint)" }}>ai-tint</div>
          <div className="h-1 rounded-ds-full" style={{ background: "var(--ds-ai-grad)" }} />
        </div>
      </Section>
    </div>
  )
}
