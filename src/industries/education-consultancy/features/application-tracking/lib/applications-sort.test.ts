import { describe, it, expect } from "vitest";
import type { Application } from "@/types/database";
import {
  compareApplications,
  sortApplications,
  nextSort,
  isApplicationSortField,
  type ApplicationSortCtx,
} from "./applications-sort";

// Client request (Manish / Admizz, Nov 2026): every Applications column header sortable.

function app(over: Record<string, unknown> = {}): Application {
  return {
    id: "a",
    university_name: "Oxford",
    program_name: "Law",
    intake_term: null,
    countries: [],
    status: "applied",
    stage_id: null,
    application_deadline: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    leads: { first_name: "Ann", last_name: "Lee" },
    ...over,
  } as unknown as Application;
}

const ctx: ApplicationSortCtx = {
  stageById: new Map([
    ["s1", { position: 0, name: "Shortlisted" }],
    ["s2", { position: 1, name: "Applied" }],
    ["s3", { position: 2, name: "Offer" }],
  ]),
};
const ids = (list: Application[]) => list.map((a) => a.id);

describe("sortApplications", () => {
  it("student: by full name, case-insensitive", () => {
    const list = [
      app({ id: "c", leads: { first_name: "carl", last_name: "Zed" } }),
      app({ id: "a", leads: { first_name: "Ann", last_name: "Lee" } }),
      app({ id: "b", leads: { first_name: "Bea", last_name: "Roy" } }),
    ];
    expect(ids(sortApplications(list, "student", "asc", ctx))).toEqual(["a", "b", "c"]);
    expect(ids(sortApplications(list, "student", "desc", ctx))).toEqual(["c", "b", "a"]);
  });

  it("university and program: A–Z / Z–A", () => {
    const list = [app({ id: "x", university_name: "Yale", program_name: "Art" }), app({ id: "y", university_name: "Brown", program_name: "Zoology" })];
    expect(ids(sortApplications(list, "university_name", "asc", ctx))).toEqual(["y", "x"]);
    expect(ids(sortApplications(list, "program", "desc", ctx))).toEqual(["y", "x"]);
  });

  it("intake sorts as a DATE (year then month), not alphabetically — January 2027 is after November 2026", () => {
    const list = [
      app({ id: "jan27", intake_term: "January 2027" }),
      app({ id: "nov26", intake_term: "November 2026" }),
      app({ id: "apr26", intake_term: "April 2026" }),
      app({ id: "sep26", intake_term: "Sep 2026" }),
    ];
    expect(ids(sortApplications(list, "intake", "asc", ctx))).toEqual(["apr26", "sep26", "nov26", "jan27"]);
    expect(ids(sortApplications(list, "intake", "desc", ctx))).toEqual(["jan27", "nov26", "sep26", "apr26"]);
  });

  it("intake text that isn't a month+year sorts after real dates", () => {
    const list = [app({ id: "txt", intake_term: "Fall" }), app({ id: "d", intake_term: "May 2026" })];
    expect(ids(sortApplications(list, "intake", "asc", ctx))).toEqual(["d", "txt"]);
  });

  it("status sorts by pipeline stage order, not alphabetically", () => {
    const list = [
      app({ id: "offer", stage_id: "s3" }),
      app({ id: "short", stage_id: "s1" }),
      app({ id: "applied", stage_id: "s2" }),
    ];
    // alphabetical would be Applied, Offer, Shortlisted
    expect(ids(sortApplications(list, "status", "asc", ctx))).toEqual(["short", "applied", "offer"]);
    expect(ids(sortApplications(list, "status", "desc", ctx))).toEqual(["offer", "applied", "short"]);
  });

  it("status with no stage falls back to its text, after every real stage", () => {
    const list = [app({ id: "raw", stage_id: null, status: "withdrawn" }), app({ id: "real", stage_id: "s1" })];
    expect(ids(sortApplications(list, "status", "asc", ctx))).toEqual(["real", "raw"]);
  });

  it("country: by the joined, normalised country list", () => {
    const list = [app({ id: "uk", countries: ["United Kingdom"] }), app({ id: "au", countries: ["Australia"] })];
    expect(ids(sortApplications(list, "country", "asc", ctx))).toEqual(["au", "uk"]);
  });

  it("deadline: earliest first ascending", () => {
    const list = [app({ id: "late", application_deadline: "2026-12-01" }), app({ id: "soon", application_deadline: "2026-03-01" })];
    expect(ids(sortApplications(list, "application_deadline", "asc", ctx))).toEqual(["soon", "late"]);
    expect(ids(sortApplications(list, "application_deadline", "desc", ctx))).toEqual(["late", "soon"]);
  });

  it("blanks are ALWAYS last, in both directions", () => {
    const list = [
      app({ id: "none", application_deadline: null, intake_term: null, countries: [], program_name: "", leads: null }),
      app({ id: "has", application_deadline: "2026-03-01", intake_term: "May 2026", countries: ["Australia"], program_name: "Law", leads: { first_name: "A", last_name: null } }),
    ];
    for (const field of ["application_deadline", "intake", "country", "program", "student"] as const) {
      expect(ids(sortApplications(list, field, "asc", ctx))).toEqual(["has", "none"]);
      expect(ids(sortApplications(list, field, "desc", ctx))).toEqual(["has", "none"]);
    }
  });

  it("created_at / updated_at keep the existing newest/oldest behaviour", () => {
    const list = [app({ id: "old", created_at: "2025-01-01T00:00:00Z", updated_at: "2025-02-01T00:00:00Z" }), app({ id: "new", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" })];
    expect(ids(sortApplications(list, "created_at", "desc", ctx))).toEqual(["new", "old"]);
    expect(ids(sortApplications(list, "updated_at", "asc", ctx))).toEqual(["old", "new"]);
  });

  it("ties keep the incoming order (stable)", () => {
    const list = [app({ id: "1", university_name: "Same" }), app({ id: "2", university_name: "Same" }), app({ id: "3", university_name: "Same" })];
    expect(ids(sortApplications(list, "university_name", "asc", ctx))).toEqual(["1", "2", "3"]);
    expect(ids(sortApplications(list, "university_name", "desc", ctx))).toEqual(["1", "2", "3"]);
  });

  it("numbers inside text sort naturally", () => {
    const list = [app({ id: "10", program_name: "Level 10" }), app({ id: "2", program_name: "Level 2" })];
    expect(ids(sortApplications(list, "program", "asc", ctx))).toEqual(["2", "10"]);
  });

  it("does not mutate the input array", () => {
    const list = [app({ id: "b", university_name: "B" }), app({ id: "a", university_name: "A" })];
    const copy = [...list];
    sortApplications(list, "university_name", "asc", ctx);
    expect(list).toEqual(copy);
  });

  it("compareApplications treats two blanks as equal", () => {
    expect(compareApplications(app({ application_deadline: null }), app({ application_deadline: null }), "application_deadline", "asc", ctx)).toBe(0);
  });
});

describe("nextSort / isApplicationSortField", () => {
  it("a different column starts ascending", () => {
    expect(nextSort({ field: "created_at", dir: "desc" }, "student")).toEqual({ field: "student", dir: "asc" });
  });
  it("the same column flips direction", () => {
    expect(nextSort({ field: "student", dir: "asc" }, "student")).toEqual({ field: "student", dir: "desc" });
    expect(nextSort({ field: "student", dir: "desc" }, "student")).toEqual({ field: "student", dir: "asc" });
  });
  it("recognises only real sort fields", () => {
    expect(isApplicationSortField("intake")).toBe(true);
    expect(isApplicationSortField("nope")).toBe(false);
  });
});
