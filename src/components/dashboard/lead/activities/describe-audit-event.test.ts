import { describe, it, expect } from "vitest";
import { describeAuditEvent } from "./describe-audit-event";

const who = (id: string) => ({ u1: "Farhan Ali" } as Record<string, string>)[id];
const ev = (action: string, changes: Record<string, { old: unknown; new: unknown }> | null = {}, entity_type = "lead") => describeAuditEvent({ action, entity_type, changes }, who);

describe("describeAuditEvent: no raw action key ever reaches the UI", () => {
  it("lead.updated with tags reads 'Updated tags'", () => {
    expect(ev("lead.updated", { tags: { old: [], new: ["NEB 2025"] } })).toEqual({ kind: "updated", verb: "Updated tags", object: null });
  });

  it("lists several changed fields once each, with today's labels (name once, address once)", () => {
    expect(ev("lead.updated", { first_name: { old: "a", new: "b" }, last_name: { old: "c", new: "d" }, address_ward: { old: 1, new: 2 }, full_address: { old: "x", new: "y" }, phone: { old: null, new: "1" } }).verb)
      .toBe("Updated name, address, phone");
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
