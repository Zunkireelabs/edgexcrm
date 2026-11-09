import { describe, expect, it } from "vitest";
import { buildDraftPrompt, draftChecks, draftFacts, draftNumbersOk, draftOk, draftSchema, produceDraft, type DraftRaw } from "./draft";
import type { DraftContext } from "../server/draft-context";

const CTX: DraftContext = {
  lead: { firstName: "Sita", fullName: "Sita Gurung", phone: "+9779841234567", email: "sita.gurung@gmail.com", destinations: ["UK"], intakeTerm: "February 2027", fieldOfStudy: null },
  applications: [{ university: "Deakin", program: "Master of IT", deadline: "2026-11-15", daysLeft: 6, stageName: "Documents", missing: ["Bank statement"], docsAssessable: true }],
  notes: [{ text: "She called from 9812345678 about the fee, mail sita.gurung@gmail.com", at: "2026-11-02T05:00:00Z" }],
  messages: [{ direction: "inbound", text: "My passport is PA1234567, see https://drive.google.com/x", at: "2026-11-03T06:00:00Z", channel: "whatsapp" }],
  lastCall: { at: "2026-11-04T05:00:00.000Z", outcome: "no_answer" },
  lastReplyChannel: "whatsapp", gmail: null, recordsRead: [],
};
const NOW = new Date("2026-11-09T08:00:00.000Z");
const IN = { counsellorFirstName: "Rita", company: "Admizz", now: NOW, tz: "Asia/Kathmandu" };

describe("draft facts and prompt", () => {
  const facts = draftFacts(CTX, IN);
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
    expect(system).toContain("never use he, she");
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
  const facts = draftFacts(CTX, IN);
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

describe("S1: the company and the counsellor as Home greets them", () => {
  it("the tenant's short name is in the facts and the prompt tells the model to introduce 'Rita from Admizz'", () => {
    const facts = draftFacts(CTX, IN);
    expect(facts).toContain("Company: Admizz");
    expect(facts).toContain("Counsellor first name: Rita");
    const { system } = buildDraftPrompt({ channel: "whatsapp", tone: "new", kind: "x", facts, previous: null, todayLabel: "t" });
    expect(system).toContain("from the Company");
    expect(system).toContain("never 'our office'");
  });
  it("S3: no profile name means no name in the facts, and the prompt says do not sign with one (never an email)", () => {
    const facts = draftFacts(CTX, { ...IN, counsellorFirstName: null });
    expect(facts.join("\n")).toContain("do not sign with a name");
    expect(facts.join("\n")).not.toContain("Counsellor first name");
    expect(facts.join("\n")).not.toMatch(/admizzintern|@/);
  });
});

describe("S2: real timing in the facts, and refusal of words the facts don't back", () => {
  const facts = draftFacts(CTX, IN);
  const ok = (o: Partial<DraftRaw> & { text: string }): DraftRaw => ({ subject: null, why: "The deadline is in 6 days.", followUp: { title: "Check for the statement", inDays: 3 }, ...o });
  it("the last call is dated: '5 days ago (no answer)'", () => {
    expect(facts).toContain("Last call with the lead: 5 days ago (no answer)");
    expect(draftFacts({ ...CTX, lastCall: null }, IN)).toContain("No call with the lead has been logged yet");
  });
  it("notes and messages carry their age too", () => {
    expect(facts.some((f) => /^Counsellor note 1 \(\d+ days ago\)/.test(f))).toBe(true);
  });
  it("'I called you yesterday' is refused when no fact says yesterday; so are हिजो and last week", () => {
    expect(draftOk(ok({ text: "Hi Sita, I called you yesterday about your bank statement." }), facts)).toBe(false);
    expect(draftOk(ok({ text: "नमस्ते Sita, मैले तपाईंलाई हिजो फोन गरेको थिएँ।" }), facts)).toBe(false);
    expect(draftOk(ok({ text: "Hi Sita, as we spoke last week." }), facts)).toBe(false);
  });
  it("the same word is allowed when a fact states it", () => {
    const withYesterday = draftFacts({ ...CTX, lastCall: { at: "2026-11-08T05:00:00.000Z", outcome: null } }, IN);
    expect(withYesterday).toContain("Last call with the lead: yesterday");
    expect(draftOk(ok({ text: "Hi Sita, I called you yesterday about your bank statement." }), withYesterday)).toBe(true);
  });
  it("saying the real timing is fine", () => {
    expect(draftOk(ok({ text: "Hi Sita, I tried calling you 5 days ago about your bank statement." }), facts)).toBe(true);
  });
});

describe("S4: names only, never he/she", () => {
  const facts = draftFacts(CTX, IN);
  const base: DraftRaw = { text: "Hi Sita, please send your bank statement.", subject: null, why: "The deadline is in 6 days.", followUp: { title: "Check for the statement", inDays: 3 } };
  it("the prompt says so, for English and Nepali, including the reason and the task", () => {
    const { system } = buildDraftPrompt({ channel: "whatsapp", tone: "new", kind: "x", facts, previous: null, todayLabel: "t" });
    expect(system).toContain("Names only");
    expect(system).toContain("in English or in Nepali");
    expect(system).toContain("reason (why) and the follow-up task");
  });
  it("a draft, reason or task with he/she/his/her is refused", () => {
    expect(draftOk({ ...base, why: "Her Australia interest is clear." }, facts)).toBe(false);
    expect(draftOk({ ...base, followUp: { title: "Call her on Thursday", inDays: 3 } }, facts)).toBe(false);
    expect(draftOk({ ...base, text: "Hi Sita, tell him to send it." }, facts)).toBe(false);
    expect(draftOk(base, facts)).toBe(true);
  });
});

describe("C1: one automatic retry that says exactly what failed", () => {
  const facts = draftFacts(CTX, IN);
  const good: DraftRaw = { text: "Hi Sita, please send your bank statement.", subject: null, why: "The deadline is in 6 days.", followUp: { title: "Check for the statement", inDays: 3 } };
  const input = { channel: "whatsapp" as const, tone: "new" as const, kind: "x", facts, previous: null, todayLabel: "t" };
  it("names the failing checks without echoing any lead text", () => {
    const bad = { ...good, text: "Hi Sita, I called yesterday.", why: "Her deadline is close." };
    expect(draftChecks(bad, facts).map((c) => c.check)).toEqual(["time_word", "pronoun"]);
    expect(draftChecks({ ...good, text: "The fee is 4500." }, facts).map((c) => c.check)).toEqual(["number"]);
  });
  it("a failing first draft is retried ONCE with the reason, and the second is shown", async () => {
    const calls: Array<string[] | undefined> = [];
    const write = async (p: { fix?: string[] }) => {
      calls.push(p.fix);
      return { raw: calls.length === 1 ? { ...good, why: "Her deadline is close." } : good, usage: {} };
    };
    const r = await produceDraft(input, write as never);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBeUndefined();
    expect(calls[1]?.join(" ")).toContain("do not use he, she");
    expect(r.raw).toEqual(good);
    expect(r.failed).toEqual([["pronoun"], []]);
  });
  it("a second failure is null ('Write your own'), and there is never a third attempt", async () => {
    let n = 0;
    const write = async () => { n++; return { raw: { ...good, text: "I called yesterday." }, usage: {} }; };
    const r = await produceDraft(input, write as never);
    expect(n).toBe(2);
    expect(r.raw).toBeNull();
    expect(r.failed).toEqual([["time_word"], ["time_word"]]);
  });
  it("a first-try success makes one call", async () => {
    let n = 0;
    const r = await produceDraft(input, (async () => { n++; return { raw: good, usage: {} }; }) as never);
    expect(n).toBe(1);
    expect(r.raw).toEqual(good);
  });
  it("the retry prompt carries the exact reason", () => {
    const { system } = buildDraftPrompt({ ...input, fix: ["no 'yesterday': no fact says when that happened"] });
    expect(system).toContain("Your previous attempt was rejected: no 'yesterday'");
  });
  it("a provider error on the first try is retried once too", async () => {
    let n = 0;
    const r = await produceDraft(input, (async () => { n++; if (n === 1) throw new Error("timeout"); return { raw: good, usage: {} }; }) as never);
    expect(r.raw).toEqual(good);
    expect(r.failed).toEqual([["provider"], []]);
  });
  it("draftOk agrees with draftChecks", () => {
    expect(draftOk(good, facts)).toBe(true);
  });
});
