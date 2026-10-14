import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXAM_TYPES,
  LIST_COLUMNS,
  LIST_TABLES,
  MAX_ROWS_PER_LIST,
  coerceList,
  coerceListsPayload,
  type ListName,
} from "./student-record-lists";

// The column lists must equal what the migrations create — a column added on one side only fails here, not as a field that silently does not save.
function tableColumns(migrationFile: string, table: string): string[] {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations", migrationFile), "utf8");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const body = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(code)?.[1] ?? "";
  return body
    .split("\n")
    .map((l) => /^\s{2}([a-z_]+)\s+[A-Z]/.exec(l)?.[1])
    .filter((c): c is string => !!c && !["id", "tenant_id", "lead_id", "created_at", "updated_at"].includes(c));
}

describe("list columns match the migrations", () => {
  it.each([
    ["work_experience", "237_lead_work_experience.sql"],
    ["references", "238_lead_references.sql"],
    ["test_scores", "235_lead_test_scores.sql"],
  ] as Array<[ListName, string]>)("%s", (list, file) => {
    expect([...LIST_COLUMNS[list]].sort()).toEqual(tableColumns(file, LIST_TABLES[list]).sort());
  });
});

describe("coerceList — work experience", () => {
  it("trims, nulls blanks, keeps real dates, keeps a valid id", () => {
    const id = "6f1c1c1e-1b2a-4c3d-8e9f-0a1b2c3d4e5f";
    const { rows, errors } = coerceList("work_experience", [
      { id, institution_name: "  Admizz  ", address: "", position: "Counselor", start_date: "2022-01-01", end_date: "" },
    ]);
    expect(errors).toEqual({});
    expect(rows).toEqual([{ id, institution_name: "Admizz", address: null, position: "Counselor", start_date: "2022-01-01", end_date: null }]);
  });

  it("drops a row with nothing filled in (an 'Add' that was never typed into)", () => {
    const { rows, errors } = coerceList("work_experience", [{ id: "x", institution_name: "  ", position: "" }, { institution_name: "Real" }]);
    expect(errors).toEqual({});
    expect(rows).toHaveLength(1);
    expect(rows[0].institution_name).toBe("Real");
  });

  it("ignores a malformed id instead of trusting it", () => {
    const { rows } = coerceList("work_experience", [{ id: "../../etc", institution_name: "A" }]);
    expect(rows[0]).not.toHaveProperty("id");
  });

  it("reports a bad date per row and column, and stores nothing from that row", () => {
    const { rows, errors } = coerceList("work_experience", [{ institution_name: "A", start_date: "01/02/2022" }, { institution_name: "B", end_date: "2023-02-30" }]);
    expect(Object.keys(errors).sort()).toEqual(["work_experience[0].start_date", "work_experience[1].end_date"]);
    expect(rows).toEqual([]);
  });

  it("rejects non-text values, over-long text, non-objects and non-lists", () => {
    expect(coerceList("work_experience", [{ position: 5 }]).errors["work_experience[0].position"]).toBeDefined();
    expect(coerceList("work_experience", [{ position: "x".repeat(501) }]).errors["work_experience[0].position"]).toBeDefined();
    expect(coerceList("work_experience", ["nope"]).errors["work_experience[0]"]).toBeDefined();
    expect(coerceList("work_experience", { a: 1 }).errors.work_experience).toBeDefined();
  });

  it(`allows up to ${MAX_ROWS_PER_LIST} rows and refuses more`, () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => ({ institution_name: `Org ${i}` }));
    expect(coerceList("work_experience", make(MAX_ROWS_PER_LIST)).errors).toEqual({});
    expect(coerceList("work_experience", make(MAX_ROWS_PER_LIST + 1)).errors.work_experience).toBeDefined();
  });

  it("an empty list is valid (it clears the stored rows)", () => {
    expect(coerceList("work_experience", [])).toEqual({ rows: [], errors: {} });
  });
});

describe("coerceList — references", () => {
  it("validates the email", () => {
    expect(coerceList("references", [{ referee_name: "Dr X", email: "x@y.co" }]).errors).toEqual({});
    expect(coerceList("references", [{ referee_name: "Dr X", email: "not-an-email" }]).errors["references[0].email"]).toBeDefined();
  });
  it("keeps every reference field", () => {
    const { rows } = coerceList("references", [{ referee_name: "A", position: "P", organization: "O", email: "a@b.co", address: "Ad", relationship: "Teacher" }]);
    expect(rows[0]).toEqual({ referee_name: "A", position: "P", organization: "O", email: "a@b.co", address: "Ad", relationship: "Teacher" });
  });
});

describe("coerceList — test scores", () => {
  it("accepts every exam type the pop-up offers, including Duolingo and Other Tests", () => {
    for (const exam of EXAM_TYPES) expect(coerceList("test_scores", [{ exam_type: exam, overall: "7" }]).errors, exam).toEqual({});
  });
  it("keeps the skill breakdown and the exam date", () => {
    const { rows } = coerceList("test_scores", [{ exam_type: "IELTS", date_of_exam: "2026-03-01", listening: "8", reading: "7.5", writing: "6.5", speaking: "7", overall: "7.5" }]);
    expect(rows[0]).toEqual({ exam_type: "IELTS", date_of_exam: "2026-03-01", listening: "8", reading: "7.5", writing: "6.5", speaking: "7", overall: "7.5" });
  });
  it("requires an exam type when anything else is filled in", () => {
    expect(coerceList("test_scores", [{ overall: "7" }]).errors["test_scores[0].exam_type"]).toBeDefined();
  });
  it("refuses an unknown exam type", () => {
    expect(coerceList("test_scores", [{ exam_type: "Made-up exam", overall: "7" }]).errors["test_scores[0].exam_type"]).toBeDefined();
  });
  it("drops a completely empty row", () => {
    expect(coerceList("test_scores", [{ exam_type: "", overall: "" }]).rows).toEqual([]);
  });
});

describe("coerceListsPayload", () => {
  it("returns only the lists that are present (an absent list is left untouched)", () => {
    const { lists, errors } = coerceListsPayload({ references: [{ referee_name: "A" }] });
    expect(errors).toEqual({});
    expect(Object.keys(lists)).toEqual(["references"]);
  });
  it("validates all lists together and reports every error", () => {
    const { lists, errors } = coerceListsPayload({ work_experience: [{ start_date: "bad" }], test_scores: [{ overall: "7" }], references: [{ referee_name: "ok" }] });
    expect(Object.keys(errors).sort()).toEqual(["test_scores[0].exam_type", "work_experience[0].start_date"]);
    expect(Object.keys(lists)).toEqual(["references"]);
  });
  it("ignores keys that are not lists", () => {
    expect(coerceListsPayload({ first_name: "X", role: "owner" })).toEqual({ lists: {}, errors: {} });
  });
});
