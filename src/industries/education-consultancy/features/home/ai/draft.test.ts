import { describe, expect, it } from "vitest";
import { buildDraftPrompt, draftFacts, draftNumbersOk, draftSchema } from "./draft";
import type { DraftContext } from "../server/draft-context";

const CTX: DraftContext = {
  lead: { firstName: "Sita", fullName: "Sita Gurung", phone: "+9779841234567", email: "sita.gurung@gmail.com", destinations: ["UK"], intakeTerm: "February 2027", fieldOfStudy: null },
  applications: [{ university: "Deakin", program: "Master of IT", deadline: "2026-11-15", daysLeft: 6, stageName: "Documents", missing: ["Bank statement"], docsAssessable: true }],
  notes: [{ text: "She called from 9812345678 about the fee, mail sita.gurung@gmail.com", at: "2026-11-08T05:00:00Z" }],
  messages: [{ direction: "inbound", text: "My passport is PA1234567, see https://drive.google.com/x", at: "2026-11-08T06:00:00Z", channel: "whatsapp" }],
  lastReplyChannel: "whatsapp", gmail: null, recordsRead: [],
};

describe("draft facts and prompt", () => {
  const facts = draftFacts(CTX, "Rita");
  const { prompt, system } = buildDraftPrompt({ channel: "whatsapp", tone: "new", kind: "x", facts, previous: "Call me on 9811111111", todayLabel: "Monday 2026-11-09" });
  it("never carry a phone, email, passport or link, anywhere in the prompt (including the previous draft)", () => {
    for (const secret of ["9779841234567", "9812345678", "sita.gurung@gmail.com", "PA1234567", "drive.google.com", "9811111111"]) {
      expect(prompt).not.toContain(secret);
      expect(system).not.toContain(secret);
    }
  });
  it("carry what Orca is allowed to read", () => {
    expect(prompt).toContain("Lead first name: Sita");
    expect(prompt).toContain("Documents still missing for Deakin: Bank statement");
    expect(prompt).toContain("6 days from today");
  });
  it("forbid sending, invented numbers and he/she", () => {
    expect(system).toContain("you never send anything");
    expect(system).toContain("must appear in the facts");
    expect(system).toContain("Never use he, she");
  });
  it("WhatsApp has no subject; email asks for one", () => {
    expect(system).toContain("no subject");
    expect(buildDraftPrompt({ channel: "email", tone: "new", kind: "x", facts, previous: null, todayLabel: "t" }).system).toContain("A subject and a short body");
  });
  it("the Nepali / shorter / formal rewrites work from the previous text", () => {
    expect(buildDraftPrompt({ channel: "whatsapp", tone: "nepali", kind: "x", facts, previous: "Hi", todayLabel: "t" }).system).toContain("Nepali (Devanagari");
    expect(buildDraftPrompt({ channel: "whatsapp", tone: "shorter", kind: "x", facts, previous: "Hi", todayLabel: "t" }).prompt).toContain("Previous message:\nHi");
  });
});

describe("draftNumbersOk", () => {
  const facts = draftFacts(CTX, "Rita");
  const raw = (text: string) => ({ text, subject: null, why: "The deadline is in 6 days." });
  it("passes numbers the facts hold (6 days, 15, 11, 2026)", () => {
    expect(draftNumbersOk(raw("Your Deakin application closes on 15 November, 6 days from now."), facts)).toBe(true);
  });
  it("refuses a number the facts don't hold", () => {
    expect(draftNumbersOk(raw("The fee is 4500."), facts)).toBe(false);
    expect(draftNumbersOk(raw("Send the last 3 months of statements."), facts)).toBe(false);
  });
  it("the schema bounds the follow-up task", () => {
    const ok = { text: "Hi", subject: null, why: "w", followUp: { title: "Check", inDays: 3 } };
    expect(draftSchema.safeParse(ok).success).toBe(true);
    expect(draftSchema.safeParse({ ...ok, followUp: { title: "Check", inDays: 30 } }).success).toBe(false);
  });
});
