import { describe, it, expect } from "vitest";
import { groupOpenState, parseStoredGroups, navGroupsCookieName, serializeGroupsCookie, parseGroupsCookie } from "./nav-groups";

const defaults = { insights: true, leads: true, students: true, grow: false, team: false };

describe("groupOpenState", () => {
  it("uses the defaults when nothing is stored (Grow and Team folded)", () => {
    expect(groupOpenState(null, defaults, null)).toEqual(defaults);
  });
  it("a stored choice beats the default", () => {
    const s = groupOpenState({ grow: true, leads: false }, defaults, null);
    expect(s.grow).toBe(true);
    expect(s.leads).toBe(false);
    expect(s.team).toBe(false);
  });
  it("the group containing the current route is always open, whatever is stored", () => {
    expect(groupOpenState({ team: false }, defaults, "team").team).toBe(true);
    expect(groupOpenState({ leads: false }, defaults, "leads").leads).toBe(true);
  });
  it("ignores an active id that is not a known group", () => {
    expect(groupOpenState(null, defaults, "nope")).toEqual(defaults);
  });
});

describe("parseStoredGroups", () => {
  it("returns null for empty / malformed / non-object values", () => {
    expect(parseStoredGroups(null)).toBeNull();
    expect(parseStoredGroups("")).toBeNull();
    expect(parseStoredGroups("{bad")).toBeNull();
    expect(parseStoredGroups("[1]")).toBeNull();
    expect(parseStoredGroups('"x"')).toBeNull();
  });
  it("keeps only boolean values", () => {
    expect(parseStoredGroups('{"a":true,"b":"no","c":false}')).toEqual({ a: true, c: false });
  });
  it("cookie name is per tenant", () => {
    expect(navGroupsCookieName("t1")).toBe("nav-groups-t1");
  });
});

import { pathMatches, navEntryHref, activeSectionId } from "./nav-groups";
import { EDUCATION_NAV_LAYOUT } from "@/industries/education-consultancy/nav-layout";

describe("active section", () => {
  it("pathMatches is segment-aware", () => {
    expect(pathMatches("/leads", "/leads")).toBe(true);
    expect(pathMatches("/leads/123", "/leads")).toBe(true);
    expect(pathMatches("/leads-organise", "/leads")).toBe(false);
  });
  it("maps entry keys to the page they stand for", () => {
    expect(navEntryHref("universal:/team")).toBe("/team");
    expect(navEntryHref("slot:lead-lists")).toBe("/leads");
    expect(navEntryHref("slot:leads-organise")).toBe("/leads-organise");
    expect(navEntryHref("slot:archive-lists")).toBeNull();
    expect(navEntryHref("/sms")).toBe("/sms");
  });
  it("finds the education group holding the current route", () => {
    expect(activeSectionId(EDUCATION_NAV_LAYOUT, "/sms")).toBe("grow");
    expect(activeSectionId(EDUCATION_NAV_LAYOUT, "/leave")).toBe("team");
    expect(activeSectionId(EDUCATION_NAV_LAYOUT, "/leads")).toBe("leads");
    expect(activeSectionId(EDUCATION_NAV_LAYOUT, "/leads-organise/abc")).toBe("leads");
    expect(activeSectionId(EDUCATION_NAV_LAYOUT, "/home")).toBe("top");
    expect(activeSectionId(EDUCATION_NAV_LAYOUT, "/nowhere")).toBeNull();
  });
});

describe("fold-state cookie", () => {
  it("serialises with path, 1-year max-age and SameSite=Lax", () => {
    const c = serializeGroupsCookie("t1", { grow: true, team: false });
    expect(c.startsWith("nav-groups-t1=")).toBe(true);
    expect(c).toContain("path=/");
    expect(c).toContain("max-age=31536000");
    expect(c).toContain("SameSite=Lax");
  });
  it("round-trips, from the raw or the already-decoded value", () => {
    const state = { grow: true, team: false };
    const raw = serializeGroupsCookie("t1", state).split("=")[1].split(";")[0];
    expect(parseGroupsCookie(raw)).toEqual(state);
    expect(parseGroupsCookie(JSON.stringify(state))).toEqual(state);
  });
  it("malformed or missing → null", () => {
    expect(parseGroupsCookie(undefined)).toBeNull();
    expect(parseGroupsCookie("%E0%A4%A")).toBeNull();
    expect(parseGroupsCookie("garbage")).toBeNull();
  });
});
