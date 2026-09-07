import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Regression test for the Phase 3 acceptance criterion in
// docs/HOME-MY-WORK-BRIEF.md: RunningTimerChip must not mount at all when the
// tenant lacks FEATURES.TIME_TRACKING — not just have its requests 403. The
// only thing that guarantees "zero /api/v1/timers requests" for a tenant like
// Admizz (education_consultancy) is that shell.tsx never renders the
// component in the first place, mirroring the aiAssistantEnabled pattern this
// file already uses. There's no React Testing Library in this project's test
// stack (see shell.nav.test.ts for the same source-text-check convention),
// so this asserts the guard exists syntactically rather than rendering.
describe("shell.tsx gates the running-timer chip on timeTrackingEnabled", () => {
  const shellSource = readFileSync(join(__dirname, "shell.tsx"), "utf8");

  it("guards <RunningTimerChip /> with timeTrackingEnabled &&", () => {
    expect(shellSource).toMatch(/timeTrackingEnabled\s*&&\s*<RunningTimerChip\s*\/>/);
  });

  it("does not render RunningTimerChip anywhere unguarded", () => {
    // Every occurrence of the JSX tag must be preceded by the same guard —
    // a second, ungated mount point would defeat the whole point.
    const occurrences = shellSource.match(/<RunningTimerChip\s*\/>/g) ?? [];
    const guarded = shellSource.match(/timeTrackingEnabled\s*&&\s*<RunningTimerChip\s*\/>/g) ?? [];
    expect(occurrences.length).toBeGreaterThan(0);
    expect(guarded.length).toBe(occurrences.length);
  });

  it("defaults timeTrackingEnabled to false when the layout doesn't pass it", () => {
    expect(shellSource).toMatch(/timeTrackingEnabled\s*=\s*false,/);
  });
});
