import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkLeadProfileCompleteness } from "./profile-completeness";

function makeChain(result: { data?: unknown; count?: number | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

function fakeDb(overrides: Record<string, { data?: unknown; count?: number | null }>) {
  return {
    from: (table: string) => makeChain(overrides[table] ?? { data: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as SupabaseClient<any>;
}

const COMPLETE_LEAD = {
  first_name: "Mahendra",
  email: "mahendra@example.com",
  phone: "+977-9865331614",
  field_of_study: "Computer Science",
  degree_level: "Bachelor",
};

describe("checkLeadProfileCompleteness", () => {
  it("is complete when name/email/phone/study info are filled and a document exists", async () => {
    const db = fakeDb({
      leads: { data: COMPLETE_LEAD },
      applicant_documents: { count: 1 },
    });
    const result = await checkLeadProfileCompleteness(db, "tenant-1", "lead-1");
    expect(result).toEqual({ complete: true, missing: [] });
  });

  it("flags every missing field on a bare lead with no document", async () => {
    const db = fakeDb({
      leads: { data: { first_name: null, email: null, phone: null, field_of_study: null, degree_level: null } },
      applicant_documents: { count: 0 },
    });
    const result = await checkLeadProfileCompleteness(db, "tenant-1", "lead-1");
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(["Name", "Email", "Phone", "Study Information", "a document"]);
  });

  it("flags Study Information when only one of field_of_study/degree_level is set", async () => {
    const db = fakeDb({
      leads: { data: { ...COMPLETE_LEAD, degree_level: null } },
      applicant_documents: { count: 1 },
    });
    const result = await checkLeadProfileCompleteness(db, "tenant-1", "lead-1");
    expect(result.missing).toEqual(["Study Information"]);
  });

  it("flags 'a document' when no applicant_documents rows exist for the lead", async () => {
    const db = fakeDb({
      leads: { data: COMPLETE_LEAD },
      applicant_documents: { count: 0 },
    });
    const result = await checkLeadProfileCompleteness(db, "tenant-1", "lead-1");
    expect(result.missing).toEqual(["a document"]);
  });

  it("treats a missing lead row as fully incomplete", async () => {
    const db = fakeDb({
      leads: { data: null },
      applicant_documents: { count: 0 },
    });
    const result = await checkLeadProfileCompleteness(db, "tenant-1", "lead-1");
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("Name");
  });
});
