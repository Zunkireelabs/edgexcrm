import { describe, it, expect } from "vitest";
import { UPDATABLE_FIELDS } from "@/lib/leads/apply-lead-patch";
import { PROFILE_FIELDS, profileFieldValue } from "./profile-fields";
import type { Lead } from "@/types/database";

describe("View all values fields", () => {
  it("only lists columns the PATCH route accepts, so an in-place edit is never dropped", () => {
    const allowed = new Set<string>(UPDATABLE_FIELDS);
    for (const f of PROFILE_FIELDS) expect(allowed.has(f.key), f.key).toBe(true);
  });
  it("has unique keys", () => {
    expect(new Set(PROFILE_FIELDS.map((f) => f.key)).size).toBe(PROFILE_FIELDS.length);
  });
  it("reads values as text, empty for null", () => {
    const lead = { first_name: "Aarav", last_name: null, custom_fields: {} } as unknown as Lead;
    expect(profileFieldValue(lead, "first_name")).toBe("Aarav");
    expect(profileFieldValue(lead, "last_name")).toBe("");
  });
});
