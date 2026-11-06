// Gradient = "Orca". Guards that AI colour/gradients stay on AI surfaces (EDGEX-85 §7c).
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { badgeV2Variants } from "./badge"
import { buttonV2Variants } from "./button"

// Adding AI to a page = add it here deliberately.
const AI_TOKEN_ALLOWLIST = [
  "src/app/globals.css",
  "src/components/ui/badge.tsx",
  "src/industries/education-consultancy/features/pulse/ui/pulse.css",
  "src/industries/education-consultancy/features/pulse/ui/briefing-card.tsx",
  "src/industries/education-consultancy/features/pulse/ui/attention-list.tsx",
  "src/industries/education-consultancy/features/pulse/ui/scoreboard.tsx",
  "src/components/design-system/showcase.tsx",
  "src/app/(main)/(dashboard)/design-system/page.tsx",
  // this test file names the tokens it searches for
  "src/components/ui/ai-gradient-guard.test.ts",
  "src/components/ui/v2-look.test.tsx",
]

const ROOT = path.resolve(__dirname, "../../..")
const GRADIENT_RE = /linear-gradient|radial-gradient|conic-gradient|bg-gradient-|bg-linear-|bg-radial-/g
const BASELINE_PATH = path.join(__dirname, "__baselines__/gradients.json")

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|css)$/.test(e.name)) out.push(full)
  }
  return out
}
const files = walk(path.join(ROOT, "src")).map((f) => path.relative(ROOT, f).split(path.sep).join("/"))

describe("AI gradient guard", () => {
  it("1. non-AI v2 variants never carry a gradient or an AI token", () => {
    const strings = [
      ...(["primary", "secondary", "ghost", "link", "destructive"] as const).flatMap((v) =>
        (["default", "sm", "icon"] as const).map((s) => buttonV2Variants({ variant: v, size: s }))
      ),
      badgeV2Variants({ variant: "neutral" }),
      badgeV2Variants({ variant: "count" }),
    ]
    for (const s of strings) {
      expect(s).not.toMatch(/gradient/)
      expect(s).not.toMatch(/ds-ai/)
    }
  })

  it("2. ds-ai tokens appear only in allowlisted files", () => {
    const offenders = files.filter((f) => {
      if (AI_TOKEN_ALLOWLIST.includes(f)) return false
      return /ds-ai-|--ds-ai\b/.test(fs.readFileSync(path.join(ROOT, f), "utf8"))
    })
    expect(offenders, `AI tokens used outside the allowlist: ${offenders.join(", ")}`).toEqual([])
  })

  it("3. ratchet: gradients never grow", () => {
    const current: Record<string, number> = {}
    for (const f of files) {
      if (f === "src/components/ui/ai-gradient-guard.test.ts") continue
      const n = (fs.readFileSync(path.join(ROOT, f), "utf8").match(GRADIENT_RE) ?? []).length
      if (n) current[f] = n
    }
    const baseline: Record<string, number> = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))
    const msg = "Gradients mean Orca. Use a --ds-ai-* token in an allowlisted AI file, or remove it."
    const grown = Object.entries(current).filter(([f, n]) => n > (baseline[f] ?? 0))
    expect(grown.map(([f, n]) => `${f}: ${n} (baseline ${baseline[f] ?? 0})`), msg).toEqual([])
    const lowered = Object.entries(baseline).filter(([f, n]) => (current[f] ?? 0) < n)
    if (lowered.length) console.log("Gradient count went down in:", lowered.map(([f]) => f).join(", "), "- lower the baseline")
  })
})
