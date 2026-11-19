import { describe, it, expect } from "vitest";
import { matchToCatalog, sameDestination, canonicalizeDestinations, countryOptionsForLead } from "./destination-normalize";

// Client report (Manish / Admizz, Nov 2026): a lead from the Nepal-UK form held "uk" and "nepal"; the catalog says
// "UK" and "Nepal". Nothing matched, so nothing showed ticked, UK couldn't be ticked, and the Add Application sheet
// listed no countries.

const CATALOG = ["Australia", "Nepal", "UK", "USA", "United Kingdom", "New Zealand"];

describe("matchToCatalog", () => {
  it("matches ignoring case and answers in the catalog's spelling", () => {
    expect(matchToCatalog("uk", CATALOG)).toBe("UK");
    expect(matchToCatalog("NEPAL", CATALOG)).toBe("Nepal");
    expect(matchToCatalog("new zealand", CATALOG)).toBe("New Zealand");
  });
  it("ignores surrounding whitespace and flag decoration", () => {
    expect(matchToCatalog("  uk ", CATALOG)).toBe("UK");
    expect(matchToCatalog("🇬🇧 UK", CATALOG)).toBe("UK");
    expect(matchToCatalog("🇺🇸 usa", CATALOG)).toBe("USA");
  });
  it("returns null for an unknown or blank value", () => {
    expect(matchToCatalog("Narnia", CATALOG)).toBeNull();
    expect(matchToCatalog("   ", CATALOG)).toBeNull();
    expect(matchToCatalog("", CATALOG)).toBeNull();
  });
  it("does not conflate genuinely different countries (UK vs United Kingdom stay separate entries)", () => {
    expect(matchToCatalog("United Kingdom", CATALOG)).toBe("United Kingdom");
    expect(matchToCatalog("uk", CATALOG)).toBe("UK");
  });
  it("an empty catalog matches nothing", () => {
    expect(matchToCatalog("uk", [])).toBeNull();
  });
});

describe("sameDestination", () => {
  it("is case/decoration-insensitive", () => {
    expect(sameDestination("uk", "UK")).toBe(true);
    expect(sameDestination("🇬🇧 UK", " uk")).toBe(true);
    expect(sameDestination("UK", "USA")).toBe(false);
  });
  it("blank is never equal to blank", () => {
    expect(sameDestination("", "")).toBe(false);
  });
});

describe("canonicalizeDestinations", () => {
  it("re-spells known values in the catalog's spelling (the Nepal-UK lead)", () => {
    expect(canonicalizeDestinations(["uk", "nepal"], CATALOG)).toEqual(["UK", "Nepal"]);
  });
  it("keeps an unknown value as cleaned — never rewritten, never dropped", () => {
    expect(canonicalizeDestinations(["Narnia", "uk"], CATALOG)).toEqual(["Narnia", "UK"]);
    expect(canonicalizeDestinations(["🇫🇷 narnia"], CATALOG)).toEqual(["narnia"]);
  });
  it("dedupes on the final spelling", () => {
    expect(canonicalizeDestinations(["uk", "UK", " Uk "], CATALOG)).toEqual(["UK"]);
  });
  it("with an empty catalog it is exactly the old normalize (strip decoration + dedupe, spelling untouched)", () => {
    expect(canonicalizeDestinations(["🇬🇧 uk", "UK"], [])).toEqual(["uk"]);
  });
  it("empty in, empty out; does not mutate the input", () => {
    const input = ["uk"];
    expect(canonicalizeDestinations([], CATALOG)).toEqual([]);
    canonicalizeDestinations(input, CATALOG);
    expect(input).toEqual(["uk"]);
  });
});

describe("countryOptionsForLead (Add Application country list)", () => {
  it("a lead with no destinations gets the whole catalog", () => {
    expect(countryOptionsForLead([], CATALOG)).toEqual(CATALOG);
  });
  it("narrows to the lead's destinations, matching ignoring case", () => {
    expect(countryOptionsForLead(["uk", "nepal"], CATALOG)).toEqual(["Nepal", "UK"]);
  });
  it("the reported bug: lowercase destinations used to leave an EMPTY list — now they match", () => {
    expect(countryOptionsForLead(["uk"], ["Australia", "UK", "USA"])).toEqual(["UK"]);
  });
  it("when NONE of the lead's destinations match the catalog, falls back to the whole catalog (never empty)", () => {
    expect(countryOptionsForLead(["Narnia"], CATALOG)).toEqual(CATALOG);
  });
  it("a partial match narrows to the matching ones", () => {
    expect(countryOptionsForLead(["Narnia", "usa"], CATALOG)).toEqual(["USA"]);
  });
  it("an empty catalog stays empty (nothing to show, nothing invented)", () => {
    expect(countryOptionsForLead(["uk"], [])).toEqual([]);
  });
});
