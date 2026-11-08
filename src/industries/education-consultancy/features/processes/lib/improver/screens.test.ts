import { describe, it, expect } from "vitest";
import { bannerText, draftsWaiting, needsText, readOrcaMeta, shortLabel, skippedLines, turnsOnInfo, whySegments, windowLabel } from "./screens";

describe("banner and list text", () => {
  it("'Orca suggests N changes for vN' + 'from X new leads, 9 Oct – 7 Nov' (Orca's own dates; left out when the run didn't count)", () => {
    expect(bannerText({ version: 3, changeCount: 2, arrived: 130, windowLabel: "9 Oct – 7 Nov" })).toEqual({ title: "Orca suggests 2 changes for v3", from: "from 130 new leads, 9 Oct – 7 Nov" });
    expect(bannerText({ version: 2, changeCount: 1, arrived: 1 })).toEqual({ title: "Orca suggests 1 change for v2", from: "from 1 new lead" });
    expect(bannerText({ version: 2, changeCount: 1, arrived: null }).from).toBeNull();
  });
  it("drafts waiting counts only Orca's", () => {
    expect(draftsWaiting([{ source: "agent" }, { source: "person" }, { source: "agent" }])).toEqual({ title: "2 drafts waiting for you", sub: "Orca, from 30 days of data" });
    expect(draftsWaiting([{ source: "agent" }])?.title).toBe("1 draft waiting for you");
    expect(draftsWaiting([{ source: "person" }, { source: "system" }])).toBeNull();
  });
  it("run metadata is read defensively", () => {
    expect(readOrcaMeta({ arrived: 131, skipped: [{ step: "a", reason: "b" }, { step: 1 }, null] })).toEqual({ arrived: 131, skipped: [{ step: "a", reason: "b" }], windowLabel: null });
    expect(readOrcaMeta(null)).toEqual({ arrived: null, skipped: [], windowLabel: null });
    expect(readOrcaMeta({ arrived: "x", skipped: "y" })).toEqual({ arrived: null, skipped: [], windowLabel: null });
  });
  it("the window is named in the tenant's days; `to` is exclusive", () => {
    // Asia/Kathmandu is UTC+5:45: 9 Oct 00:00 local .. 8 Nov 00:00 local
    const w = { from: "2026-10-08T18:15:00.000Z", to: "2026-11-07T18:15:00.000Z" };
    expect(windowLabel(w, "Asia/Kathmandu")).toBe("9 Oct – 7 Nov");
    expect(readOrcaMeta({ arrived: 130, window: w }, "Asia/Kathmandu").windowLabel).toBe("9 Oct – 7 Nov");
    expect(windowLabel({ from: "x", to: "y" }, "UTC")).toBeNull();
    expect(windowLabel(undefined, "UTC")).toBeNull();
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
  it("bolds only the numbers that match evidence, and links the ones that have an href; other numbers stay plain", () => {
    const { segments, rest } = whySegments("Only 30% of Sunday leads: 17 of 122 arrived on a Saturday after 3 calls.", [ev("17 of 122", "/leads?f=sat"), ev("30%", null)]);
    expect(segments.filter((s) => s.bold).map((s) => [s.text, s.href ?? null])).toEqual([["30%", null], ["17 of 122", "/leads?f=sat"]]);
    expect(rest).toEqual([]);
    expect(segments.map((s) => s.text).join("")).toBe("Only 30% of Sunday leads: 17 of 122 arrived on a Saturday after 3 calls.");
    expect(whySegments("Called within 1 working hour, or 5 minutes later.", [ev("18%", null)]).segments.some((s) => s.bold)).toBe(false);
  });
  it("never links an item without an href, and never matches inside a longer number", () => {
    const { segments } = whySegments("There were 117 leads.", [ev("17", "/leads?f=x")]);
    expect(segments.some((s) => s.href)).toBe(false);
    expect(whySegments("About 17 leads.", [ev("17", null)]).segments.find((s) => s.bold)?.href).toBeUndefined();
  });
  it("evidence the sentence never quotes comes back as 'rest', with its href only if it has one", () => {
    const { rest } = whySegments("Saturday leads wait.", [ev("17 of 17", null, "never contacted"), ev("17 of 131", "/leads?f=s", "Saturday")]);
    expect(rest).toEqual([{ label: "never contacted", value: "17 of 17" }, { label: "saturday", value: "17 of 131", href: "/leads?f=s" }]);
  });
  it("short labels drop the 'Step:' prefix and lower-case the first word", () => {
    expect(shortLabel("First contact: Contacted within 1 working hour")).toBe("contacted within 1 working hour");
    expect(shortLabel("Saturday: Saturday leads called within 1 working hour")).toBe("saturday leads called within 1 working hour");
    expect(shortLabel("SMS sent")).toBe("SMS sent");
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
