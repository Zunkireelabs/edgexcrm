import { describe, it, expect } from "vitest";
import { manifest as itAgencyManifest } from "./manifest";
import { IT_AGENCY_NAV_LAYOUT, type ItAgencyNavEntryKey } from "./nav-layout";
import { resolveNavSections } from "../_nav-sections";
import { getIndustrySidebarItems } from "../_loader";
import type { SidebarItem } from "../_types";

const KNOWN_UNIVERSAL_HREFS = new Set([
  "/home",
  "/dashboard",
  "/knowledge-bases",
  "/pipeline",
  "/inbox",
  "/team",
  "/people",
  "/leave",
  "/attendance",
]);

const KNOWN_SLOTS = new Set(["slot:leads-organise", "slot:leads-funnels", "slot:archive-lists"]);

const allEntryKeys = IT_AGENCY_NAV_LAYOUT.flatMap((s) => s.entries);
const industryHrefKeys = allEntryKeys.filter(
  (k) => !k.startsWith("universal:") && !KNOWN_SLOTS.has(k),
);

describe("IT_AGENCY_NAV_LAYOUT integrity", () => {
  it("every universal: key names a href this test recognizes (catches a typo'd href)", () => {
    for (const key of allEntryKeys) {
      if (!key.startsWith("universal:")) continue;
      const href = key.slice("universal:".length);
      expect(KNOWN_UNIVERSAL_HREFS.has(href), `unknown universal href in key "${key}"`).toBe(true);
    }
  });

  it("every industry-href key resolves to a manifest sidebar item", () => {
    const manifestHrefs = new Set(itAgencyManifest.sidebar.map((e) => (e as SidebarItem).href));
    for (const key of industryHrefKeys) {
      expect(manifestHrefs.has(key), `"${key}" is not registered in it-agency manifest.sidebar`).toBe(true);
    }
  });

  it("every slot: key is a known bespoke slot", () => {
    for (const key of allEntryKeys) {
      if (!key.startsWith("slot:")) continue;
      expect(KNOWN_SLOTS.has(key), `unknown slot key "${key}"`).toBe(true);
    }
  });

  it("section ids are unique", () => {
    const ids = IT_AGENCY_NAV_LAYOUT.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Resourcing/Utilization live in Delivery, not Organization", () => {
  const delivery = IT_AGENCY_NAV_LAYOUT.find((s) => s.id === "delivery");
  const organization = IT_AGENCY_NAV_LAYOUT.find((s) => s.id === "organization");

  it("Delivery contains /resourcing and /resourcing/utilization", () => {
    expect(delivery?.entries).toContain("/resourcing");
    expect(delivery?.entries).toContain("/resourcing/utilization");
  });

  it("Organization does not contain them", () => {
    expect(organization?.entries).not.toContain("/resourcing");
    expect(organization?.entries).not.toContain("/resourcing/utilization");
  });
});

describe("parity: pure refactor plus one item move", () => {
  it("ordered entry keys match the brief's target layout exactly", () => {
    // docs/IT-AGENCY-PHASE5-DELIVERY-NAV-IA-BRIEF.md §1b — the spec table.
    const expected: ItAgencyNavEntryKey[] = [
      "universal:/home",
      "universal:/dashboard",
      "universal:/knowledge-bases",
      "slot:leads-organise",
      "slot:leads-funnels",
      "/outreach",
      "slot:archive-lists",
      "universal:/pipeline",
      "/proposals",
      "/deals",
      "/services",
      "/accounts",
      "/contacts",
      "/projects",
      "/tasks",
      "/time-tracking",
      "/approvals",
      "/resourcing",
      "/resourcing/utilization",
      "universal:/inbox",
      "universal:/team",
      "universal:/people",
      "universal:/leave",
      "universal:/attendance",
    ];
    expect(allEntryKeys).toEqual(expected);
  });

  it("resolveNavSections preserves that order for an owner with everything resolving", () => {
    // Every key resolves to itself — simulates a fully-featured tenant where
    // no entry is gated out.
    const sections = resolveNavSections(IT_AGENCY_NAV_LAYOUT, (key) => key);
    const flat = sections.flatMap((s) => s.items.map((i) => i.key));
    expect(flat).toEqual(allEntryKeys);
  });
});

describe("resolveNavSections: empty sections render no header", () => {
  it("drops a section whose every entry resolves to null", () => {
    const sections = resolveNavSections(
      IT_AGENCY_NAV_LAYOUT,
      (key) => (key === "/approvals" ? null : key), // simulate non-admin: only Approvals gone
    );
    // Delivery still renders (5 of its 6 entries survive).
    expect(sections.find((s) => s.id === "delivery")).toBeTruthy();

    // Now simulate every Delivery entry vanishing (e.g. a tenant with none
    // of these features registered) — Delivery must not appear at all.
    const deliveryHrefs = new Set(
      IT_AGENCY_NAV_LAYOUT.find((s) => s.id === "delivery")!.entries,
    );
    const allDeliveryGone = resolveNavSections(IT_AGENCY_NAV_LAYOUT, (key) =>
      deliveryHrefs.has(key) ? null : key,
    );
    expect(allDeliveryGone.find((s) => s.id === "delivery")).toBeUndefined();
    // Headerless "home" section still renders since its entry survives.
    expect(allDeliveryGone.find((s) => s.id === "home")).toBeTruthy();
  });

  it("a headerless section (no label) still renders its items when non-empty", () => {
    const sections = resolveNavSections(IT_AGENCY_NAV_LAYOUT, (key) => key);
    const home = sections.find((s) => s.id === "home");
    expect(home?.label).toBeUndefined();
    expect(home?.items.map((i) => i.key)).toEqual(["universal:/home"]);
  });
});

describe("getIndustrySidebarItems still applies manifest permission filtering", () => {
  it("a non-admin does not get /approvals (minRoles: owner/admin)", () => {
    const items = getIndustrySidebarItems("it_agency", "staff") as SidebarItem[];
    expect(items.some((i) => i.href === "/approvals")).toBe(false);
  });

  it("an owner gets /approvals", () => {
    const items = getIndustrySidebarItems("it_agency", "owner") as SidebarItem[];
    expect(items.some((i) => i.href === "/approvals")).toBe(true);
  });
});
