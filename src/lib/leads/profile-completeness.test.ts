import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkLeadProfileCompleteness } from "./profile-completeness";

function makeChain(result: { data?: unknown; count?: number | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    limit: () => chain,
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

const CONSENT_TEMPLATE = {
  is_active: true,
  body: "{{student_name}} {{nationality}} {{passport_number}} {{street_address}} {{parent_name}} {{guardian_relationship}}",
};

describe("checkLeadProfileCompleteness — basic info = consent fields, no documents", () => {
  it("is complete with no active template once name/email/phone/study info are filled — and NO document", async () => {
    const db = fakeDb({ leads: { data: COMPLETE_LEAD }, consent_templates: { data: null } });
    expect(await checkLeadProfileCompleteness(db, "tenant-1", "lead-1")).toEqual({ complete: true, missing: [] });
  });

  it("never asks for a document, even when the lead has none (the Subhan Ali case)", async () => {
    const db = fakeDb({
      leads: { data: COMPLETE_LEAD },
      consent_templates: { data: null },
      applicant_documents: { count: 0 },
    });
    const result = await checkLeadProfileCompleteness(db, "tenant-1", "lead-1");
    expect(result.complete).toBe(true);
    expect(result.missing).not.toContain("a document");
  });

  it("flags every missing always-required field on a bare lead", async () => {
    const db = fakeDb({
      leads: { data: { first_name: null, email: null, phone: null, field_of_study: null, degree_level: null } },
      consent_templates: { data: null },
    });
    const result = await checkLeadProfileCompleteness(db, "tenant-1", "lead-1");
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(["First Name", "Email", "Phone", "Field of Study", "Degree Level"]);
  });

  it("with an active consent template, also requires the fields behind its placeholders", async () => {
    const db = fakeDb({ leads: { data: COMPLETE_LEAD }, consent_templates: { data: CONSENT_TEMPLATE } });
    const result = await checkLeadProfileCompleteness(db, "tenant-1", "lead-1");
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining(["Nationality", "Passport Number", "Address", "Guardian Name", "Guardian Relationship"]),
    );
  });

  it("is complete when the consent-template fields are filled", async () => {
    const db = fakeDb({
      leads: {
        data: {
          ...COMPLETE_LEAD,
          nationality: "Nepali",
          passport_number: "P123",
          full_address: "Kapilvastu",
          guardian_name: "Hari Ali",
          guardian_relationship: "Father",
        },
      },
      consent_templates: { data: CONSENT_TEMPLATE },
    });
    expect(await checkLeadProfileCompleteness(db, "tenant-1", "lead-1")).toEqual({ complete: true, missing: [] });
  });

  it("a lead whose consent is already SIGNED is not re-checked against template fields (a later template edit can't lock them out)", async () => {
    const db = fakeDb({
      leads: { data: COMPLETE_LEAD },
      consent_templates: { data: CONSENT_TEMPLATE },
      lead_consents: { data: { id: "consent-1" } },
    });
    expect(await checkLeadProfileCompleteness(db, "tenant-1", "lead-1")).toEqual({ complete: true, missing: [] });
  });

  it("a signed consent does not excuse the always-required fields (name / email / phone / study info)", async () => {
    const db = fakeDb({
      leads: { data: { ...COMPLETE_LEAD, phone: null } },
      consent_templates: { data: CONSENT_TEMPLATE },
      lead_consents: { data: { id: "consent-1" } },
    });
    expect((await checkLeadProfileCompleteness(db, "tenant-1", "lead-1")).missing).toEqual(["Phone"]);
  });

  it("an inactive template adds no extra requirements", async () => {
    const db = fakeDb({ leads: { data: COMPLETE_LEAD }, consent_templates: { data: { ...CONSENT_TEMPLATE, is_active: false } } });
    expect((await checkLeadProfileCompleteness(db, "tenant-1", "lead-1")).complete).toBe(true);
  });

  it("treats a missing lead row as fully incomplete", async () => {
    const db = fakeDb({ leads: { data: null }, consent_templates: { data: null } });
    const result = await checkLeadProfileCompleteness(db, "tenant-1", "lead-1");
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("First Name");
  });

  it("judges values sent in the same request, not the stale stored row", async () => {
    const db = fakeDb({ leads: { data: { ...COMPLETE_LEAD, phone: null } }, consent_templates: { data: null } });
    expect((await checkLeadProfileCompleteness(db, "tenant-1", "lead-1")).missing).toEqual(["Phone"]);
    const fixed = await checkLeadProfileCompleteness(db, "tenant-1", "lead-1", { phone: "+977-9865331614" });
    expect(fixed).toEqual({ complete: true, missing: [] });
  });

  it("a pending value that clears a field makes it missing; unrelated pending keys are ignored", async () => {
    const db = fakeDb({ leads: { data: COMPLETE_LEAD }, consent_templates: { data: null } });
    const r = await checkLeadProfileCompleteness(db, "tenant-1", "lead-1", { email: null, pre_app_fee_status: "paid" });
    expect(r.missing).toEqual(["Email"]);
  });
});
