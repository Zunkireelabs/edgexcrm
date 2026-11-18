import { describe, expect, it } from "vitest";
import { buildDraftPrompt, draftChecks, draftFacts, draftNumbersOk, draftOk, draftSchema, produceDraft, quoteIsInNotes, type DraftRaw } from "./draft";
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
    const ok = { skip: null, text: "Hi", subject: null, why: "w", followUp: { title: "Check", inDays: 3 } };
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
    expect(system).toContain("You are writing TO the lead");
    expect(system).toContain("in English or in Nepali");
    expect(system).toContain("In the reason (why), the follow-up task and any skip reason");
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

describe("P1: check-ins are short, specific and don't end on a stock line", () => {
  const facts = draftFacts(CTX, IN);
  const good: DraftRaw = { text: "Hi Sita, Rita from Admizz. Did you get a chance to look at the Deakin checklist?", subject: null, why: "Quiet for 5 days.", followUp: { title: "Check back", inDays: 3 } };
  const ci = { rowKind: "going_quiet" };
  it("a short, specific check-in passes", () => {
    expect(draftChecks(good, facts, ci)).toEqual([]);
  });
  it("over 400 characters is refused", () => {
    const long = { ...good, text: "Hi Sita, " + "asking how your plans are coming along. ".repeat(10) };
    expect(long.text.length).toBeGreaterThan(400);
    expect(draftChecks(long, facts, ci).map((c) => c.check)).toContain("length");
  });
  it.each([
    "If you have any questions or would like to pick up where we left off, just reply here and I'll be happy to help.",
    "Feel free to reach out anytime.",
    "Don't hesitate to message me.",
    "Let me know if you need anything.",
  ])("the stock closing '%s' is refused", (closing) => {
    expect(draftChecks({ ...good, text: `Hi Sita, how is the IELTS prep going? ${closing}` }, facts, ci).map((c) => c.check)).toContain("stock_closing");
  });
  it("the rules apply to check-ins only: a reply may be longer and is not refused for a polite close", () => {
    const reply = { ...good, text: "Hi Sita, " + "here is the answer to your question about the intake. ".repeat(9) + "Feel free to reach out." };
    expect(draftChecks(reply, facts, { rowKind: "reply_waiting" })).toEqual([]);
  });
  it("a refused check-in is retried once with the reason, then shown", async () => {
    const calls: Array<string[] | undefined> = [];
    const write = async (p: { fix?: string[] }) => { calls.push(p.fix); return { raw: calls.length === 1 ? { ...good, text: "Hi Sita, how is it going? Just reply here and I'll be happy to help." } : good, usage: {} }; };
    const r = await produceDraft({ channel: "whatsapp", tone: "new", kind: "x", rowKind: "going_quiet", facts, previous: null, todayLabel: "t" }, write as never);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.join(" ")).toContain("do not end with a stock line");
    expect(r.raw).toEqual(good);
    expect(r.failed).toEqual([["stock_closing"], []]);
  });
  it("the prompt asks for at most 2 sentences, under 280 characters, one specific detail, one question, and names the stock lines", () => {
    const { system } = buildDraftPrompt({ channel: "whatsapp", tone: "new", kind: "x", rowKind: "going_quiet", facts, previous: null, todayLabel: "t" });
    for (const t of ["AT MOST 2 sentences after the greeting", "under 280 characters", "ONE specific fact", "single question you end with", "just reply here", "Never open with a stock line"]) expect(system).toContain(t);
    expect(buildDraftPrompt({ channel: "whatsapp", tone: "new", kind: "x", rowKind: "reply_waiting", facts, previous: null, todayLabel: "t" }).system).not.toContain("AT MOST 2 sentences");
  });
});

describe("P2: first-try pass rate over 20 fixed outputs (a measure of the CHECKS on realistic outputs, not of the live model)", () => {
  const facts = draftFacts(CTX, IN);
  const mk = (text: string, why = "Quiet for 5 days."): DraftRaw => ({ text, subject: null, why, followUp: { title: "Check back", inDays: 3 } });
  // 14 specific short check-ins of the kind the new prompt asks for, 6 of the old-template kind the checks must catch.
  const specific = [
    "Hi Sita, Rita from Admizz. Did you get a chance to look at the Deakin checklist?",
    "Hi Sita, Rita here. How is the IELTS booking going, did you pick a date?",
    "Hi Sita, Rita from Admizz. Shall I book a short call to go through the UK intake?",
    "Hi Sita, did your parents get to read the fee sheet I sent?",
    "Hi Sita, Rita from Admizz. Have you decided between Deakin and Federation?",
    "Hi Sita, is the bank statement on its way?",
    "Hi Sita, Rita here. Would Thursday suit you for a quick call about your course?",
    "Hi Sita, did the scholarship details I sent make sense?",
    "Hi Sita, Rita from Admizz. Are you still thinking about February intake?",
    "Hi Sita, how are the transcripts coming along?",
    "Hi Sita, Rita here. Did you hear back from your referee?",
    "Hi Sita, did you get to look at the Australia partner list?",
    "Hi Sita, Rita from Admizz. Can I help with the SOP draft?",
    "Hi Sita, is your passport copy ready to upload?",
  ].map((t) => mk(t));
  const template = [
    "Hi Sita, it's Rita from Admizz. I wanted to check in and see how things are going with your application. If you have any questions or would like to pick up where we left off, just reply here and I'll be happy to help.",
    "Hi Sita, Rita here. Just checking in. Feel free to reach out anytime.",
    "Hi Sita, I called yesterday about your file.",
    "Hi Sita, tell her about the deadline.",
    "Hi Sita, " + "I am following up on your enquiry and wanted to share more details. ".repeat(8),
    "Hi Sita, the fee is 4500, just reply here and I'll be happy to help.",
  ].map((t) => mk(t));
  it("14 of 20 pass on the first try and the 6 template-style outputs are all caught by a named check", () => {
    const results = [...specific, ...template].map((r) => draftChecks(r, facts, { rowKind: "going_quiet" }));
    const passed = results.filter((r) => r.length === 0).length;
    expect(passed).toBe(14);
    expect(passed / results.length).toBe(0.7);
    expect(results.slice(14).every((r) => r.length > 0)).toBe(true);
  });
});


describe("Q1: Orca may answer 'don't send', with the counsellor's own words", () => {
  const ctx: DraftContext = { ...CTX, notes: [{ text: "He is already in Korea, studying there. Number is not registered on WhatsApp.", at: "2026-11-02T05:00:00Z" }], messages: [] };
  const facts = draftFacts(ctx, IN);
  const base: DraftRaw = { skip: null, text: "", subject: null, why: "", followUp: { title: "", inDays: 3 } };
  const skip = (quote: string, reason = "Bishal is already abroad, so asking about studying in the UK is pointless."): DraftRaw => ({ ...base, skip: { reason, quote } });

  it("a skip whose quote is word for word in a note passes (only in a batch)", () => {
    expect(draftChecks(skip("is already in Korea"), facts, { allowSkip: true, rowKind: "going_quiet" })).toEqual([]);
    expect(draftChecks(skip("Number is not registered on WhatsApp."), facts, { allowSkip: true })).toEqual([]);
  });
  it("the quote must really be in a counsellor note or message: an invented or rephrased quote is refused", () => {
    expect(draftChecks(skip("he moved abroad"), facts, { allowSkip: true }).map((c) => c.check)).toEqual(["skip_quote"]);
  });
  it("the lead's own record (destinations, intake) is not a place a quote can come from", () => {
    expect(quoteIsInNotes("Interested in studying in: UK", facts)).toBe(false);
    expect(quoteIsInNotes("studying there", facts)).toBe(true);
  });
  it("the reason follows the rules of a draft: no he / she, no number the facts don't hold", () => {
    expect(draftChecks(skip("is already in Korea", "He is already abroad."), facts, { allowSkip: true }).map((c) => c.check)).toEqual(["pronoun"]);
    expect(draftChecks(skip("is already in Korea", "Already abroad for 9 months."), facts, { allowSkip: true }).map((c) => c.check)).toEqual(["number"]);
  });
  it("the single Draft button never skips: a skip there is a refused attempt, and the retry says to write the message", () => {
    expect(draftChecks(skip("is already in Korea"), facts).map((c) => c.check)).toEqual(["empty"]);
    expect(buildDraftPrompt({ channel: "whatsapp", tone: "new", kind: "x", facts, previous: null, todayLabel: "t" }).system).toContain("Always write the message and set skip to null");
  });
  it("an empty message with no skip is refused", () => {
    expect(draftChecks(base, facts, { allowSkip: true }).map((c) => c.check)).toContain("empty");
  });
  it("the batch prompt tells the model when to skip, to copy the words exactly, and never to skip for a quiet lead", () => {
    const { system } = buildDraftPrompt({ channel: "whatsapp", tone: "new", kind: "x", rowKind: "going_quiet", allowSkip: true, facts, previous: null, todayLabel: "t" });
    for (const t of ["READ THE NOTES BEFORE WRITING", "EXACT words", "already abroad", "not on WhatsApp", "Skip ONLY when the note or message itself says so"]) expect(system).toContain(t);
  });
  it("the prompt says notes may say he or she and never to copy it (Q1c)", () => {
    const { system } = buildDraftPrompt({ channel: "whatsapp", tone: "new", kind: "x", facts, previous: null, todayLabel: "t" });
    expect(system).toContain("may say he or she. Never copy that");
  });
  it("a skip is accepted on the first try and not retried", async () => {
    let n = 0;
    const r = await produceDraft({ channel: "whatsapp", tone: "new", kind: "x", rowKind: "going_quiet", allowSkip: true, facts, previous: null, todayLabel: "t" }, (async () => (n++, { raw: skip("is already in Korea"), usage: {} })) as never);
    expect(n).toBe(1);
    expect(r.raw?.skip?.quote).toBe("is already in Korea");
  });
});

describe("Q1b: check-ins stop sounding alike", () => {
  const facts = draftFacts(CTX, IN);
  const mk = (text: string): DraftRaw => ({ skip: null, text, subject: null, why: "Quiet for 5 days.", followUp: { title: "Check back", inDays: 3 } });
  it.each(["Hi Sita, it's Rita from Admizz. I wanted to check in on your file.", "Hi Sita, just checking in.", "Hi Sita, Rita here. Just wanted to see how the IELTS prep is going?"])("'%s' is refused as a stock opening", (text) => {
    expect(draftChecks(mk(text), facts, { rowKind: "going_quiet" }).map((c) => c.check)).toContain("stock_opening");
  });
  it("F7: '5 December' matches a fact that holds 2026-12-05 (leading zeros do not count)", () => {
    const f = [...facts, "Application: Deakin, Master of IT, stage Documents, deadline 2026-12-05 (25 days from today)"];
    expect(draftChecks({ ...mk("Hi Sita, is the Deakin file ready before 5 December?"), why: "Deadline is 5 December." }, f, { rowKind: "reply_waiting" })).toEqual([]);
  });
  it("F1: every kind is held to it, not only a check-in", () => {
    expect(draftChecks(mk("Hi Sita, I wanted to check in on the checklist."), facts, { rowKind: "reply_waiting" }).map((c) => c.check)).toContain("stock_opening");
  });
  it.each(["Hi Sita, I remember you were looking at Australia. Which course?", "Hi Sita, I hope you're doing well! Is the IELTS booked?", "Hi Sita, hope you're doing well. Any news?", "Hi Sita, how is your decision process going?", "Hi Sita, it's been a while. Which country?", "Hi Sita, it's been some time.", "Hi Sita, since we last spoke, did the bank statement come?"])("F1: '%s' is a stock opening", (text) => {
    expect(draftChecks(mk(text), facts, { rowKind: "reply_waiting" }).map((c) => c.check)).toContain("stock_opening");
  });
  it("F1: a check-in has at most 2 sentences after the greeting (and the counsellor's own line)", () => {
    const three = "Hi Sita, Rita here. Australia is a good fit for nursing. Your IELTS is booked. Which date is it?";
    expect(draftChecks(mk(three), facts, { rowKind: "going_quiet" }).map((c) => c.check)).toContain("sentences");
    expect(draftChecks(mk("Hi Sita, Rita here. Is your IELTS in December booked yet?"), facts, { rowKind: "going_quiet" })).toEqual([]);
    expect(draftChecks(mk("Hi Sita, Is the IELTS in December booked? Did your father agree on the fee?"), facts, { rowKind: "going_quiet" })).toEqual([]);
  });
  it("F2: the lead's name is in the greeting once, never again in the message", () => {
    expect(draftChecks(mk("Hi Sita, how are Sita's plans for Australia?"), facts, { rowKind: "going_quiet" }).map((c) => c.check)).toContain("name_repeat");
    expect(draftChecks(mk("Hi Sita, how are your plans for Australia?"), facts, { rowKind: "going_quiet" })).toEqual([]);
  });
  it("F3: a skip reason that doubles the name or copies the note is refused; plain words pass", () => {
    const sk = (reason: string, quote: string): DraftRaw => ({ skip: { reason, quote }, text: "", subject: null, why: "", followUp: { title: "", inDays: 1 } });
    const f = [...facts, "Counsellor note 1 (6 days ago): Sita doesnoyt have any plans abroad."];
    expect(draftChecks(sk("Sita says Sita doesnoyt have any plans abroad", "doesnoyt have any plans abroad"), f, { allowSkip: true }).map((c) => c.check)).toContain("skip_reason");
    expect(draftChecks(sk("Doesnoyt have any plans abroad", "doesnoyt have any plans abroad"), f, { allowSkip: true }).map((c) => c.check)).toContain("skip_reason");
    expect(draftChecks(sk("No plans to study abroad for now", "doesnoyt have any plans abroad"), f, { allowSkip: true })).toEqual([]);
  });
  it("the prompt bans the openers and ties the single question to the one detail", () => {
    const { system } = buildDraftPrompt({ channel: "whatsapp", tone: "new", kind: "x", rowKind: "going_quiet", facts, previous: null, todayLabel: "t" });
    expect(system).toContain("'check in', 'checking in', 'wanted to', 'just wanted', 'I remember', 'I hope you'");
    expect(system).toContain("Open with just 'Hi <name>, <counsellor> here.'");
    expect(system).toContain("must name that fact");
  });
});

describe("Q1(c): the facts carry the lead's name where the note said he / she, and the prompt ends on the rule", () => {
  const ctx: DraftContext = { ...CTX, notes: [{ text: "She is waiting for her results. Her father said he will pay.", at: "2026-11-02T05:00:00Z" }], messages: [] };
  const facts = draftFacts(ctx, IN);
  it("a note's pronouns are swapped for the first name in what the model reads", () => {
    expect(facts.find((f) => f.startsWith("Counsellor note 1"))).toContain("Sita is waiting for Sita's results. Sita's father said Sita will pay.");
    expect(ctx.notes[0].text).toContain("She is waiting"); // the record itself is untouched
  });
  it("the last thing the model reads is the lead's name and the rule, including for family and the skip reason", () => {
    const { prompt } = buildDraftPrompt({ channel: "whatsapp", tone: "new", kind: "x", rowKind: "going_quiet", facts, previous: null, todayLabel: "t" });
    const tail = prompt.slice(prompt.lastIndexOf("Reminder:"));
    expect(tail).toContain("write the name Sita only in the greeting");
    expect(tail).toContain("write Sita or Sita's, never he, she, his, her or him");
    expect(tail).toContain("\"Sita's father\", not \"her father\"");
    expect(tail).toContain("skip reason");
    expect(tail).toContain("Do not write 'check in'");
    expect(buildDraftPrompt({ channel: "whatsapp", tone: "new", kind: "x", rowKind: "reply_waiting", facts, previous: null, todayLabel: "t" }).prompt).not.toContain("Do not write 'check in'");
  });
});
