import { describe, it, expect } from "vitest";
import {
  EDUCATION_NAV_LAYOUT,
  EDUCATION_DEFAULT_FOLDED,
  EDUCATION_NAV_LABELS,
  type EducationNavEntryKey,
} from "./nav-layout";
import { resolveNavSections } from "../_nav-sections";
import { manifest } from "./manifest";

const keysOf = (id: string) => EDUCATION_NAV_LAYOUT.find((s) => s.id === id)!.entries;

describe("EDUCATION_NAV_LAYOUT", () => {
  it("has the approved groups in order, Home/Inbox headerless", () => {
    expect(EDUCATION_NAV_LAYOUT.map((s) => [s.id, s.label])).toEqual([
      ["top", undefined],
      ["insights", "Insights"],
      ["leads", "Leads"],
      ["students", "Students"],
      ["grow", "Grow"],
      ["team", "Team"],
    ]);
    expect(keysOf("top")).toEqual(["universal:/home", "universal:/inbox"]);
    expect(keysOf("insights")).toEqual(["/pulse", "/insights/dashboards", "universal:/knowledge-bases"]);
    expect(keysOf("leads")).toEqual(["slot:lead-lists", "universal:/pipeline", "slot:leads-organise", "universal:/contacts"]);
    expect(keysOf("students")).toEqual(["/applications", "/classes", "/check-in"]);
    expect(keysOf("grow")).toEqual(["/forms", "/campaigns", "/sms", "/email-campaigns", "/outreach"]);
    expect(keysOf("team")).toEqual(["universal:/team", "universal:/leave", "universal:/attendance"]);
  });

  it("Grow and Team start folded; nothing else does", () => {
    expect(EDUCATION_DEFAULT_FOLDED).toEqual(["grow", "team"]);
  });

  it("no archive entry (it lives in the shared footer)", () => {
    const all = EDUCATION_NAV_LAYOUT.flatMap((s) => s.entries as readonly string[]);
    expect(all.some((k) => k.includes("archive"))).toBe(false);
  });

  it("every href key is a manifest sidebar entry (no orphaned keys)", () => {
    const hrefs = new Set(manifest.sidebar.flatMap((e) => (e.kind === "group" ? e.children : [e])).map((i) => i.href));
    for (const k of EDUCATION_NAV_LAYOUT.flatMap((s) => s.entries)) {
      if (k.startsWith("/")) expect(hrefs.has(k)).toBe(true);
    }
  });

  it("every manifest sidebar entry appears in the layout (nothing silently dropped)", () => {
    const all = new Set(EDUCATION_NAV_LAYOUT.flatMap((s) => s.entries as readonly string[]));
    for (const e of manifest.sidebar.flatMap((x) => (x.kind === "group" ? x.children : [x]))) {
      expect(all.has(e.href)).toBe(true);
    }
  });

  it("sentence-case display labels", () => {
    expect(EDUCATION_NAV_LABELS["universal:/knowledge-bases"]).toBe("Knowledge base");
    expect(EDUCATION_NAV_LABELS["universal:/team"]).toBe("Org structure");
    expect(EDUCATION_NAV_LABELS["/check-in"]).toBe("Check-in");
    expect(EDUCATION_NAV_LABELS["/email-campaigns"]).toBe("Email campaigns");
  });
});

describe("resolving with a counsellor-style navAllowed", () => {
  // Counsellor: manifest-level gates already drop admin-only items from
  // industrySidebarItems; navAllowed drops the universal ones they lack.
  const hidden = new Set<EducationNavEntryKey>([
    "/pulse",
    "slot:leads-organise",
    "/campaigns",
    "/sms",
    "/email-campaigns",
    "universal:/team",
  ]);
  const resolve = (k: EducationNavEntryKey) => (hidden.has(k) ? null : k);

  it("drops Pulse/Organise/Campaigns/SMS/Email campaigns/Org structure, keeps the rest in order", () => {
    const sections = resolveNavSections(EDUCATION_NAV_LAYOUT, resolve);
    const flat = sections.flatMap((s) => s.items.map((i) => i.key));
    for (const k of hidden) expect(flat).not.toContain(k);
    expect(flat).toContain("slot:lead-lists");
    expect(flat).toContain("/check-in");
    expect(flat).toContain("/outreach");
    expect(flat).toContain("universal:/leave");
  });

  it("a group with nothing left has no header", () => {
    const only = (keep: EducationNavEntryKey[]) =>
      resolveNavSections(EDUCATION_NAV_LAYOUT, (k) => (keep.includes(k) ? k : null));
    const sections = only(["universal:/home", "/applications"]);
    expect(sections.map((s) => s.id)).toEqual(["top", "students"]);
    expect(sections.find((s) => s.id === "insights")).toBeUndefined();
    expect(sections.find((s) => s.id === "team")).toBeUndefined();
  });
});
