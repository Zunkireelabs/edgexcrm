import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FINANCIAL_COLUMNS,
  QUALIFICATION_DETAIL_COLUMNS,
  STUDENT_RECORD_COLUMNS,
  coerceStudentRecordPayload,
} from "./student-record-columns";

// The column list must equal what the migrations actually create — if someone adds a column to a migration (or this list) and forgets
// the other side, this fails instead of the field silently not saving.
function columnsAdded(migrationFile: string): string[] {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations", migrationFile), "utf8");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  return [...code.matchAll(/ADD COLUMN IF NOT EXISTS\s+([a-z_]+)/gi)].map((m) => m[1]);
}

describe("student record columns match the migrations", () => {
  it("qualification details = migration 236 (19 columns)", () => {
    const fromMigration = columnsAdded("236_lead_qualification_details.sql").sort();
    expect(fromMigration).toHaveLength(19);
    expect([...QUALIFICATION_DETAIL_COLUMNS].sort()).toEqual(fromMigration);
  });
  it("financial = migration 239 (4 columns)", () => {
    const fromMigration = columnsAdded("239_lead_financial_details.sql").sort();
    expect(fromMigration).toHaveLength(4);
    expect([...FINANCIAL_COLUMNS].sort()).toEqual(fromMigration);
  });
  it("has no duplicates", () => {
    expect(new Set(STUDENT_RECORD_COLUMNS).size).toBe(STUDENT_RECORD_COLUMNS.length);
  });
});

describe("coerceStudentRecordPayload", () => {
  it("trims text and turns blanks into null", () => {
    const { values, errors } = coerceStudentRecordPayload({ see_address: "  Kathmandu  ", plus_two_address: "   ", sponsor_name: "" });
    expect(errors).toEqual({});
    expect(values).toEqual({ see_address: "Kathmandu", plus_two_address: null, sponsor_name: null });
  });

  it("accepts real dates and rejects malformed or impossible ones, per column", () => {
    const ok = coerceStudentRecordPayload({ see_start_date: "2015-04-01", see_end_date: "" });
    expect(ok.values).toEqual({ see_start_date: "2015-04-01", see_end_date: null });
    const bad = coerceStudentRecordPayload({ see_start_date: "04/01/2015", bachelor_end_date: "2023-02-30", masters_start_date: "2020-13-01" });
    expect(Object.keys(bad.errors).sort()).toEqual(["bachelor_end_date", "masters_start_date", "see_start_date"]);
    expect(bad.values).toEqual({});
  });

  it("rejects non-text values and over-long text", () => {
    expect(coerceStudentRecordPayload({ see_address: 5 }).errors.see_address).toBeDefined();
    expect(coerceStudentRecordPayload({ source_of_funds: "x".repeat(501) }).errors.source_of_funds).toBeDefined();
    expect(coerceStudentRecordPayload({ source_of_funds: "x".repeat(500) }).errors).toEqual({});
  });

  it("leaves columns that are not in the body out entirely (an untouched field is never overwritten)", () => {
    expect(coerceStudentRecordPayload({ sponsor_name: "Hari" }).values).toEqual({ sponsor_name: "Hari" });
    expect(coerceStudentRecordPayload({}).values).toEqual({});
    expect(coerceStudentRecordPayload({ sponsor_name: undefined }).values).toEqual({});
  });

  it("explicit null clears a value", () => {
    expect(coerceStudentRecordPayload({ see_address: null }).values).toEqual({ see_address: null });
  });

  it("ignores keys that are not student-record columns", () => {
    expect(coerceStudentRecordPayload({ first_name: "X", role: "owner" }).values).toEqual({});
  });
});
