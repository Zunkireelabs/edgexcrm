import { describe, it, expect } from "vitest";
import { newLeadEvent, type NewLeadAlertPayload } from "./new-lead";
import type { NotifyDb } from "../types";

function dbWithList(list: { name: string | null; is_intake: boolean } | null): NotifyDb {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: list });
  return { from: () => chain } as unknown as NotifyDb;
}

const base: NewLeadAlertPayload = {
  tenantId: "t1",
  leadId: "11111111-1111-1111-1111-111111111111",
  firstName: "Subhan",
  lastName: "Ali",
  email: "subhan@example.com",
  phone: "+977-9821995842",
  source: "Website enquiry",
  listId: "l1",
  isFinal: true,
};

describe("newLeadEvent.prepare — only a final lead in the intake list notifies", () => {
  it("eligible when the lead's list is the intake list (and carries its name)", async () => {
    expect(await newLeadEvent.prepare(base, dbWithList({ name: "New Leads", is_intake: true }))).toEqual({ listName: "New Leads" });
  });
  it("NOT eligible when the lead landed in another stage", async () => {
    expect(await newLeadEvent.prepare(base, dbWithList({ name: "Prospects", is_intake: false }))).toBeNull();
  });
  it("NOT eligible when the list does not exist / belongs to another tenant", async () => {
    expect(await newLeadEvent.prepare(base, dbWithList(null))).toBeNull();
  });
  it("NOT eligible for a partial (in-progress) lead", async () => {
    expect(await newLeadEvent.prepare({ ...base, isFinal: false }, dbWithList({ name: "New Leads", is_intake: true }))).toBeNull();
  });
  it("a lead with no stage is excluded unless the caller (external integration) opts in", async () => {
    const db = dbWithList(null);
    expect(await newLeadEvent.prepare({ ...base, listId: null }, db)).toBeNull();
    expect(await newLeadEvent.prepare({ ...base, listId: null, treatNoStageAsNew: true }, db)).toEqual({ listName: "New Leads" });
  });
});

describe("newLeadEvent.build", () => {
  const tenant = { id: "t1", name: "Admizz Education", primaryColor: "#112233" };
  const recipient = { userId: "u1", email: "boss@admizz.com", name: null };

  it("shows name, contact details, source and a link to the lead", () => {
    const m = newLeadEvent.build({ payload: base, context: { listName: "New Leads" }, tenant, recipient });
    expect(m.subject).toBe("New lead: Subhan Ali — Admizz Education");
    for (const s of ["Subhan Ali", "subhan@example.com", "+977-9821995842", "Website enquiry", "New Leads"]) {
      expect(m.html).toContain(s);
      expect(m.text).toContain(s);
    }
    expect(m.html).toContain("/leads/11111111-1111-1111-1111-111111111111");
    expect(m.text).toContain("/leads/11111111-1111-1111-1111-111111111111");
  });

  it("escapes a hostile name and copes with a lead that has no name/phone/source", () => {
    const evil = newLeadEvent.build({ payload: { ...base, firstName: "<script>x</script>", lastName: null }, context: { listName: "New Leads" }, tenant, recipient });
    expect(evil.html).not.toContain("<script>x</script>");
    const bare = newLeadEvent.build({
      payload: { ...base, firstName: null, lastName: null, email: null, phone: null, source: null },
      context: { listName: "New Leads" },
      tenant,
      recipient,
    });
    expect(bare.subject).toBe("New lead: A new lead — Admizz Education");
    expect(bare.html).not.toContain("Phone");
  });
});
