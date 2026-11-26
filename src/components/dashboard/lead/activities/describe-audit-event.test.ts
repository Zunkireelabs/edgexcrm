import { describe, it, expect } from "vitest";
import { describeAuditEvent } from "./describe-audit-event";

const who = (id: string) => ({ u1: "Farhan Ali" } as Record<string, string>)[id];
const ev = (action: string, changes: Record<string, { old: unknown; new: unknown }> | null = {}, entity_type = "lead") => describeAuditEvent({ action, entity_type, changes }, who);

describe("describeAuditEvent: no raw action key ever reaches the UI", () => {
  it("lead.updated with tags reads 'Updated tags'", () => {
    expect(ev("lead.updated", { tags: { old: [], new: ["NEB 2025"] } })).toEqual({ kind: "updated", verb: "Updated tags", object: null });
  });

  it("fields that never show their values are listed once each, with today's labels (address once, qualification once)", () => {
    expect(ev("lead.updated", { address_ward: { old: 1, new: 2 }, full_address: { old: "x", new: "y" }, tags: { old: [], new: ["a"] }, passport_number: { old: "P1", new: "P2" } }).verb)
      .toBe("Updated address, tags, passport number");
  });

  it("lead.updated with nothing changed, and an UNKNOWN action, fall back to 'Updated the lead'", () => {
    expect(ev("lead.updated", {}).verb).toBe("Updated the lead");
    expect(ev("lead.updated", null).verb).toBe("Updated the lead");
    const unknown = ev("lead.frobnicated", { x: { old: 1, new: 2 } }, "lead");
    expect(unknown.verb).toBe("Updated the lead");
    expect(`${unknown.verb} ${unknown.object ?? ""}`).not.toMatch(/lead\.frobnicated|\w\.\w/);
  });

  it("known events keep their wording", () => {
    expect(ev("lead.updated", { stage_id: { old: "a", new: "Prospects" } })).toMatchObject({ kind: "stage", verb: "Stage changed to" });
    expect(ev("lead.updated", { assigned_to: { old: null, new: "u1" } })).toMatchObject({ kind: "assigned", object: "Farhan Ali" });
    expect(ev("lead.merged").verb).toBe("Merged a duplicate record");
    expect(ev("lead.created").kind).toBe("created");
    expect(ev("lead.deleted").verb).toBe("Deleted the lead");
  });
});

// Stage #678: collaborator add/remove lines say who (the audit row stores the user id). The education lead page's
// Activity tab, Overview and record preview all read through this function, so it is ported here.
describe("describeAuditEvent: collaborator added / removed say who", () => {
  it("added: names the person added", () => {
    expect(ev("lead.collaborator_added", { collaborator: { old: null, new: "u1" } })).toEqual({ kind: "assigned", verb: "Added collaborator", object: "Farhan Ali" });
  });
  it("removed: names the person removed", () => {
    expect(ev("lead.collaborator_removed", { collaborator: { old: "u1", new: null } })).toEqual({ kind: "unassigned", verb: "Removed collaborator", object: "Farhan Ali" });
  });
  it("an id that can't be resolved (account gone) keeps a plain line, and never shows the raw action key", () => {
    const added = ev("lead.collaborator_added", { collaborator: { old: null, new: "gone" } });
    expect(added).toEqual({ kind: "assigned", verb: "Added a collaborator", object: null });
    expect(ev("lead.collaborator_removed", {}).verb).toBe("Removed a collaborator");
    expect(`${added.verb}`).not.toMatch(/lead\.collaborator/);
  });
});

describe("describeAuditEvent: an edit shows the old and new value for short, safe fields", () => {
  const verb = (changes: Record<string, { old: unknown; new: unknown }>) => ev("lead.updated", changes).verb;

  it("email: from the old to the new", () => {
    expect(verb({ email: { old: "a@x.com", new: "b@x.com" } })).toBe("Updated email from a@x.com to b@x.com");
  });
  it("set from empty, and cleared", () => {
    expect(verb({ email: { old: null, new: "b@x.com" } })).toBe("Updated email to b@x.com");
    expect(verb({ phone: { old: "+977-98", new: "" } })).toBe("Updated phone (was +977-98)");
  });
  it("name uses the full name; first or last alone uses what changed", () => {
    expect(verb({ first_name: { old: "a", new: "b" }, last_name: { old: "c", new: "d" } })).toBe("Updated name from a c to b d");
    expect(verb({ first_name: { old: "Laxmi", new: "Lakshmi" } })).toBe("Updated name from Laxmi to Lakshmi");
  });
  it("several fields: values where safe, plain names elsewhere, ';' between them", () => {
    expect(verb({ first_name: { old: "a", new: "b" }, last_name: { old: "c", new: "d" }, address_ward: { old: 1, new: 2 }, full_address: { old: "x", new: "y" }, phone: { old: null, new: "1" } }))
      .toBe("Updated name from a c to b d; address; phone to 1");
  });
  it("values with commas stay readable", () => {
    expect(verb({ city: { old: "Salyan, Nepal", new: "Kathmandu, Nepal" }, country: { old: "Nepal", new: "India" } }))
      .toBe("Updated city from Salyan, Nepal to Kathmandu, Nepal; country from Nepal to India");
  });
  it("source is shown as its readable name", () => {
    expect(verb({ intake_source: { old: "manual_entry", new: "social_media" } })).toBe("Updated source from Manual Entry to Social Media");
  });
  it("at most three fields carry values; the rest are only named", () => {
    expect(verb({ email: { old: "a", new: "b" }, phone: { old: "1", new: "2" }, city: { old: "c", new: "d" }, country: { old: "e", new: "f" } }))
      .toBe("Updated email from a to b; phone from 1 to 2; city from c to d; country");
  });
  it("a long value is shortened", () => {
    const long = "x".repeat(100);
    const out = verb({ city: { old: "a", new: long } });
    expect(out.length).toBeLessThan(100);
    expect(out).toContain("…");
  });
  it("sensitive and structured fields never show a value, only their name", () => {
    expect(verb({ date_of_birth: { old: "2000-01-01", new: "2001-02-03" } })).toBe("Updated date of birth");
    expect(verb({ passport_number: { old: "P111", new: "P222" } })).toBe("Updated passport number");
    expect(verb({ pre_app_fee_amount: { old: 0, new: 5000 } })).toBe("Updated pre app fee amount");
    expect(verb({ tags: { old: ["a"], new: ["b"] } })).toBe("Updated tags");
    expect(verb({ destinations: { old: ["UK"], new: ["USA"] } })).toBe("Updated destinations");
    expect(verb({ custom_fields: { old: { a: 1 }, new: { a: 2 } } })).toBe("Updated details");
  });
  it("a value that is not simple text (an object or list) is never printed", () => {
    expect(verb({ email: { old: ["a"], new: { x: 1 } } })).toBe("Updated email");
  });
  it("an old audit row in an unexpected shape just names the field", () => {
    expect(verb({ email: "weird" as unknown as { old: unknown; new: unknown } })).toBe("Updated email");
    expect(verb({ phone: { old: null, new: null } })).toBe("Updated phone");
  });
  it("other event kinds keep their wording", () => {
    expect(ev("lead.updated", { stage_id: { old: "a", new: "Prospects" } })).toMatchObject({ kind: "stage", verb: "Stage changed to" });
    expect(ev("lead.updated", { email: { old: "a", new: "b" }, stage_id: { old: "x", new: "Prospects" } })).toMatchObject({ kind: "stage" });
  });
});
