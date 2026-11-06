import { describe, expect, it } from "vitest"

import { transformSource, unifiedDiff } from "./ds-v2-migrate.mjs"

const imp = (names: string, mod: string) => `import { ${names} } from "${mod}"\n`
const btn = (jsx: string) => imp("Button", "@/components/ui/button") + `export const X = () => (${jsx})\n`
const run = (src: string) => transformSource(src, "f.tsx")

describe("ds-v2-migrate", () => {
  it.each([
    ["default", "primary"], ["outline", "secondary"], ["secondary", "secondary"],
    ["ghost", "ghost"], ["link", "link"], ["destructive", "destructive"],
  ])("Button variant %s -> %s", (from, to) => {
    const r = run(btn(`<Button variant="${from}">x</Button>`))
    expect(r.output).toContain(`<Button look="v2" variant="${to}">x</Button>`)
  })

  it("Button with no variant gets an explicit primary (legacy default is the solid fill)", () => {
    expect(run(btn(`<Button>x</Button>`)).output).toContain(`<Button look="v2" variant="primary">`)
  })

  it.each([
    ["default", "default"], ["lg", "default"], ["sm", "sm"], ["xs", "sm"],
    ["icon", "icon"], ["icon-sm", "icon"], ["icon-xs", "icon"], ["icon-lg", "icon"],
  ])("Button size %s -> %s", (from, to) => {
    expect(run(btn(`<Button variant="ghost" size="${from}" />`)).output).toContain(`size="${to}"`)
  })

  it("accepts variant={'literal'} and aliased imports", () => {
    const src = imp("Button as B", "@/components/ui/button") + `const X = () => <B variant={"outline"} />\n`
    expect(run(src).output).toContain(`<B look="v2" variant="secondary" />`)
  })

  it("Badge: secondary/outline -> neutral; everything else needs a human", () => {
    const b = (v: string) => imp("Badge", "@/components/ui/badge") + `const X = () => <Badge variant="${v}">x</Badge>\n`
    expect(run(b("secondary")).output).toContain(`<Badge look="v2" variant="neutral">`)
    expect(run(b("outline")).output).toContain(`variant="neutral"`)
    for (const v of ["success", "warning", "destructive", "default", "ghost"]) {
      const r = run(b(v))
      expect(r.changed).toBe(false)
      expect(r.report[0].kind).toBe("needs-human")
    }
    const none = run(imp("Badge", "@/components/ui/badge") + `const X = () => <Badge>x</Badge>\n`)
    expect(none.changed).toBe(false)
    expect(none.report[0].kind).toBe("needs-human")
  })

  it("Table and SheetContent just get look", () => {
    const t = imp("Table", "@/components/ui/table") + `const X = () => <Table className="a"><tbody /></Table>\n`
    expect(run(t).output).toContain(`<Table look="v2" className="a">`)
    const s = imp("SheetContent", "@/components/ui/sheet") + `const X = () => <SheetContent side="right" />\n`
    expect(run(s).output).toContain(`<SheetContent look="v2" side="right" />`)
  })

  it("never guesses: dynamic, unknown, spread, asChild and buttonVariants go to the report", () => {
    const cases = [
      `<Button variant={v}>x</Button>`,
      `<Button variant="mystery">x</Button>`,
      `<Button size={s} variant="ghost">x</Button>`,
      `<Button variant="ghost" size="huge">x</Button>`,
      `<Button {...props}>x</Button>`,
      `<Button variant={a ? "ghost" : "link"}>x</Button>`,
    ]
    for (const c of cases) {
      const r = run(btn(c))
      expect(r.changed, c).toBe(false)
      expect(r.output, c).toBe(btn(c))
      expect(r.report.some((x) => x.kind === "needs-human"), c).toBe(true)
    }
    const bv = run(imp("buttonVariants", "@/components/ui/button") + `const c = buttonVariants({ variant: "ghost" })\n`)
    expect(bv.changed).toBe(false)
    expect(bv.report[0].component).toBe("buttonVariants")
  })

  it("asChild Button migrates like any other Button", () => {
    const r = run(btn(`<Button asChild variant="outline"><a href="/x">x</a></Button>`))
    expect(r.changed).toBe(true)
    expect(r.output).toContain(`<Button look="v2" asChild variant="secondary">`)
    const b = run(imp("Badge", "@/components/ui/badge") + `const X = () => <Badge asChild variant="secondary"><a /></Badge>\n`)
    expect(b.changed).toBe(true)
  })

  it("reports className utilities that fight the v2 look, but still migrates", () => {
    const r = run(btn(`<Button variant="ghost" className="rounded-[8px] hover:bg-red-50 px-4 text-sm flex ml-2 text-left">x</Button>`))
    expect(r.changed).toBe(true)
    const rev = r.report.find((x) => x.kind === "review")!
    expect(rev.message).toContain("rounded-[8px]")
    expect(rev.message).toContain("hover:bg-red-50")
    expect(rev.message).toContain("px-4")
    expect(rev.message).toContain("text-sm")
    expect(rev.message).not.toContain("flex")
    expect(rev.message).not.toContain("ml-2")
    expect(rev.message).not.toContain("text-left")
    const cn = run(btn(`<Button className={cn("h-9", cond && "shadow-lg")}>x</Button>`))
    expect(cn.report.find((x) => x.kind === "review")!.message).toMatch(/h-9.*shadow-lg/)
    expect(run(btn(`<Button className="ml-2">x</Button>`)).report.some((x) => x.kind === "review")).toBe(false)
  })

  it("skips elements that already have look, and ignores other imports", () => {
    const done = btn(`<Button look="v2" variant="primary">x</Button>`)
    expect(run(done).changed).toBe(false)
    const other = imp("Button", "some-other-lib") + `const X = () => <Button variant="ghost" />\n`
    expect(run(other).changed).toBe(false)
  })

  it("is idempotent: a second run changes nothing", () => {
    const src =
      imp("Button", "@/components/ui/button") + imp("Badge", "@/components/ui/badge") + imp("Table", "@/components/ui/table") +
      `const X = () => (<Table><Button variant="outline" size="sm">x</Button><Badge variant="secondary">b</Badge><Button>y</Button></Table>)\n`
    const once = run(src)
    expect(once.changed).toBe(true)
    const twice = run(once.output)
    expect(twice.changed).toBe(false)
    expect(twice.output).toBe(once.output)
  })

  it("unifiedDiff shows only changed lines with context", () => {
    const before = btn(`<Button variant="outline">x</Button>`)
    const after = run(before).output
    const d = unifiedDiff("f.tsx", before, after)
    expect(d).toContain('-export const X = () => (<Button variant="outline">x</Button>)')
    expect(d).toContain('+export const X = () => (<Button look="v2" variant="secondary">x</Button>)')
    expect(unifiedDiff("f.tsx", before, before)).toBe("")
  })
})
