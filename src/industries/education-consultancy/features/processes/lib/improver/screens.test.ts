import { describe, it, expect } from "vitest";
import { bannerText, draftsWaiting, needsText, readOrcaMeta, skippedLines, turnsOnInfo, whySegments } from "./screens";

describe("banner and list text", () => {
  it("'Orca suggests N changes for vN' + 'from X new leads in 30 days' (left out when the run didn't count)", () => {
    expect(bannerText({ version: 3, changeCount: 2, arrived: 131 })).toEqual({ title: "Orca suggests 2 changes for v3", from: "from 131 new leads in 30 days" });
    expect(bannerText({ version: 2, changeCount: 1, arrived: 1 })).toEqual({ title: "Orca suggests 1 change for v2", from: "from 1 new lead in 30 days" });
    expect(bannerText({ version: 2, changeCount: 1, arrived: null }).from).toBeNull();
  });
  it("drafts waiting counts only Orca's", () => {
    expect(draftsWaiting([{ source: "agent" }, { source: "person" }, { source: "agent" }])).toEqual({ title: "2 drafts waiting for you", sub: "Orca, from 30 days of data" });
    expect(draftsWaiting([{ source: "agent" }])?.title).toBe("1 draft waiting for you");
    expect(draftsWaiting([{ source: "person" }, { source: "system" }])).toBeNull();
  });
  it("run metadata is read defensively", () => {
    expect(readOrcaMeta({ arrived: 131, skipped: [{ step: "a", reason: "b" }, { step: 1 }, null] })).toEqual({ arrived: 131, skipped: [{ step: "a", reason: "b" }] });
    expect(readOrcaMeta(null)).toEqual({ arrived: null, skipped: [] });
    expect(readOrcaMeta({ arrived: "x", skipped: "y" })).toEqual({ arrived: null, skipped: [] });
  });
});

describe("skipped lines", () => {
  const sk = ["a", "b", "c", "d"].map((s) => ({ step: s, reason: `r-${s}` }));
  it("two shown, the rest 'more'; step names come from the spec, else the key; a 'step:' prefix is ignored", () => {
    const out = skippedLines([{ step: "step:a", reason: "r" }, ...sk.slice(1)], (k) => (k === "a" ? "Alpha" : null));
    expect(out.shown.map((l) => l.step)).toEqual(["Alpha", "b"]);
    expect(out.more.map((l) => l.step)).toEqual(["c", "d"]);
    expect(skippedLines([], () => null)).toEqual({ shown: [], more: [] });
  });
});

describe("the Why sentence", () => {
  const ev = (value: string, href: string | null, label = "x") => ({ metric: "m", label, value, stepKey: null, href });
  it("bolds numbers and links the ones that have an evidence href", () => {
    const { segments, rest } = whySegments("Only 30% of Sunday leads: 17 of 122 arrived on a Saturday after 3 calls.", [ev("17 of 122", "/leads?f=sat"), ev("30%", null)]);
    expect(segments.filter((s) => s.bold).map((s) => [s.text, s.href ?? null])).toEqual([["30%", null], ["17 of 122", "/leads?f=sat"], ["3", null]]);
    expect(rest).toEqual([]);
    expect(segments.map((s) => s.text).join("")).toBe("Only 30% of Sunday leads: 17 of 122 arrived on a Saturday after 3 calls.");
  });
  it("never links an item without an href, and never matches inside a longer number", () => {
    const { segments } = whySegments("There were 117 leads.", [ev("17", "/leads?f=x")]);
    expect(segments.some((s) => s.href)).toBe(false);
    expect(whySegments("About 17 leads.", [ev("17", null)]).segments.find((s) => s.bold)?.href).toBeUndefined();
  });
  it("evidence the sentence never quotes comes back as 'rest', with its href only if it has one", () => {
    const { rest } = whySegments("Saturday leads wait.", [ev("17 of 17", null, "never contacted"), ev("17 of 131", "/leads?f=s", "Saturday")]);
    expect(rest).toEqual([{ label: "never contacted", value: "17 of 17" }, { label: "Saturday", value: "17 of 131", href: "/leads?f=s" }]);
  });
});

describe("badges", () => {
  it("needs reads like the mockup; an unknown id still says what it means", () => {
    expect(needsText("EDGEX-104")).toBe("needs per-lead SMS · EDGEX-104");
    expect(needsText("EDGEX-105")).toBe("needs a feature that is not built yet · EDGEX-105");
    expect(needsText("EDGEX-999")).toBe("needs a feature that is not built yet · EDGEX-999");
  });
  it("turns-on points at the Lead Management settings; unknown or empty gives nothing", () => {
    expect(turnsOnInfo("smart_assignment_shadow")).toEqual({ label: "Settings → Smart assignment → Shadow", href: "?settings=lead-management" });
    expect(turnsOnInfo("smart_assignment_auto")?.label).toBe("Settings → Smart assignment → Auto");
    expect(turnsOnInfo("nope")).toBeNull();
    expect(turnsOnInfo(null)).toBeNull();
  });
});
