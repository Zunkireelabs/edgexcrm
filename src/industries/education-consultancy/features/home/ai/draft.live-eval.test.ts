import { describe, it, expect } from "vitest";
import type { DraftContext } from "../server/draft-context";
import { draftChecks, draftFacts, writeDraft, type DraftRaw } from "./draft";

/**
 * Q1(c): the FIRST-TRY pass rate of the live model on 23 fixed, invented fact sets whose notes say he / she / his / her (the thing the
 * model kept copying). Opt-in, because it calls the real provider: `RUN_LIVE_DRAFT_EVAL=1 npx vitest run <this file>` with the provider key in
 * the environment. Skipped everywhere else (CI never calls a model). Invented people only: no customer data.
 */
const NOW = new Date("2026-11-10T08:00:00.000Z");
const IN = { counsellorFirstName: "Kamana", company: "Admizz", now: NOW, tz: "Asia/Kathmandu" };
const note = (text: string, daysAgo = 6) => ({ text, at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString() });
const ctx = (first: string, o: Partial<DraftContext> & { notes: DraftContext["notes"] }): DraftContext => ({
  lead: { firstName: first, fullName: `${first} Test`, phone: "+9779800000000", email: null, destinations: [], intakeTerm: null, fieldOfStudy: null },
  applications: [], lastCall: { at: new Date(NOW.getTime() - 9 * 86_400_000).toISOString(), outcome: "no_answer" }, messages: [], lastReplyChannel: null, gmail: null, recordsRead: [], ...o,
});
const dest = (d: string[], extra: Partial<DraftContext["lead"]> = {}) => ({ firstName: "", fullName: "", phone: "+9779800000000", email: null, destinations: d, intakeTerm: null, fieldOfStudy: null, ...extra });

// expectSkip: the note rules the message out, so a skip is right; otherwise a skip is a mistake.
const SETS: Array<{ name: string; c: DraftContext; expectSkip: boolean }> = [
  { name: "already in Korea", expectSkip: true, c: ctx("Bishal", { lead: { ...dest(["UK"]), firstName: "Bishal", fullName: "Bishal Test" }, notes: [note("He is already in Korea, working there.", 64)] }) },
  { name: "no plans abroad", expectSkip: true, c: ctx("Nisha", { lead: { ...dest(["Australia"]), firstName: "Nisha", fullName: "Nisha Test" }, notes: [note("She doesn't have any plans regarding abroad. Parents against it.", 40)] }) },
  { name: "not on whatsapp", expectSkip: true, c: ctx("Kamal", { notes: [note("Number is not registered on WhatsApp.", 12)] }) },
  { name: "not interested", expectSkip: true, c: ctx("Rina", { lead: { ...dest(["Canada"]), firstName: "Rina", fullName: "Rina Test" }, notes: [note("Told me she is not interested anymore, please do not call again.", 20)] }) },
  { name: "ielts", expectSkip: false, c: ctx("Aman", { lead: { ...dest(["UK"], { fieldOfStudy: "Computing" }), firstName: "Aman", fullName: "Aman Test" }, notes: [note("He is preparing for IELTS, exam booked for December. His score target is 6.5.")] }) },
  { name: "waiting for results", expectSkip: false, c: ctx("Sita", { lead: { ...dest(["Australia"], { fieldOfStudy: "Nursing" }), firstName: "Sita", fullName: "Sita Test" }, notes: [note("Her +2 results come out next month. She will decide after that.", 10)] }) },
  { name: "parents fee", expectSkip: false, c: ctx("Dipesh", { lead: { ...dest(["USA"]), firstName: "Dipesh", fullName: "Dipesh Test" }, notes: [note("He needs to talk to his parents about the fee sheet. Said he will call back.", 5)] }) },
  { name: "scholarship", expectSkip: false, c: ctx("Manisha", { lead: { ...dest(["UK"], { intakeTerm: "September 2027" }), firstName: "Manisha", fullName: "Manisha Test" }, notes: [note("She asked about scholarships at Deakin and whether her GPA of 3.4 is enough.", 7)] }) },
  { name: "visa interview", expectSkip: false, c: ctx("Prakash", { lead: { ...dest(["Japan"]), firstName: "Prakash", fullName: "Prakash Test" }, notes: [note("His visa interview was moved. He is nervous about it.", 4)] }) },
  { name: "bank statement", expectSkip: false, c: ctx("Laxmi", { lead: { ...dest(["Australia"]), firstName: "Laxmi", fullName: "Laxmi Test" }, applications: [{ university: "Deakin", program: "Master of IT", deadline: "2026-12-05", daysLeft: 25, stageName: "Documents", missing: ["Bank statement"], docsAssessable: true }], notes: [note("Her father is arranging the bank statement. She said it takes a week.", 8)] }) },
  { name: "course choice", expectSkip: false, c: ctx("Suman", { lead: { ...dest(["Canada"]), firstName: "Suman", fullName: "Suman Test" }, notes: [note("He is torn between business analytics and data science. Wants to see the course outlines.", 9)] }) },
  { name: "busy exams", expectSkip: false, c: ctx("Anita", { lead: { ...dest(["UK"]), firstName: "Anita", fullName: "Anita Test" }, notes: [note("She is busy with final exams until the 20th, asked me to call after.", 3)] }) },
  { name: "cost worry", expectSkip: false, c: ctx("Roshan", { lead: { ...dest(["Australia"]), firstName: "Roshan", fullName: "Roshan Test" }, notes: [note("He thinks Australia is too expensive and wants to compare with Malaysia.", 11)] }) },
  { name: "transcript", expectSkip: false, c: ctx("Pooja", { lead: { ...dest(["USA"], { fieldOfStudy: "Biology" }), firstName: "Pooja", fullName: "Pooja Test" }, notes: [note("She is waiting for her college to release the transcript.", 13)] }) },
  { name: "sibling abroad", expectSkip: false, c: ctx("Bibek", { lead: { ...dest(["UK"]), firstName: "Bibek", fullName: "Bibek Test" }, notes: [note("His brother studies in Leeds and he wants to go to the same city.", 6)] }) },
  { name: "work experience", expectSkip: false, c: ctx("Sarita", { lead: { ...dest(["Australia"], { fieldOfStudy: "Hospitality" }), firstName: "Sarita", fullName: "Sarita Test" }, notes: [note("She has 2 years of hotel work experience and wants credit for it.", 15)] }) },
  { name: "message from lead", expectSkip: false, c: ctx("Kiran", { lead: { ...dest(["UK"]), firstName: "Kiran", fullName: "Kiran Test" }, notes: [note("He said he would send his passport scan by Friday.", 5)], messages: [{ direction: "inbound", text: "Sir, which intake is better, January or May?", at: new Date(NOW.getTime() - 5 * 86_400_000).toISOString(), channel: "whatsapp" }], lastReplyChannel: "whatsapp" }) },
  { name: "ielts retake", expectSkip: false, c: ctx("Binita", { lead: { ...dest(["Canada"]), firstName: "Binita", fullName: "Binita Test" }, notes: [note("Her IELTS was 5.5, she wants to retake. Her coaching class starts Monday.", 14)] }) },
  { name: "family decision", expectSkip: false, c: ctx("Hari", { lead: { ...dest(["Japan"], { fieldOfStudy: "Engineering" }), firstName: "Hari", fullName: "Hari Test" }, notes: [note("He is deciding with his wife whether to go alone or with her.", 18)] }) },
  // F5: three real-shaped notes (the shapes that failed on the Admizz copy). Invented people and words, no customer data.
  { name: "real-shaped: Kristi plans", expectSkip: false, c: ctx("Kristi", { lead: { ...dest(["Australia"], { fieldOfStudy: "Nursing" }), firstName: "Kristi", fullName: "Kristi Test" }, notes: [note("Kristi is thinking about Australia for nursing. She said her family will decide after the results.", 12)] }) },
  { name: "real-shaped: Abhishek family", expectSkip: false, c: ctx("Abhishek", { lead: { ...dest(["Canada"]), firstName: "Abhishek", fullName: "Abhishek Test" }, notes: [note("Abhishek is discussing with his family about going to Canada. Father is worried about the cost.", 9)] }) },
  { name: "real-shaped: Nisha typo", expectSkip: true, c: ctx("Nisha", { lead: { ...dest(["Australia"]), firstName: "Nisha", fullName: "Nisha Test" }, notes: [note("Nisha doesnoyt have any plans regarding abroad.", 33)] }) },
];

describe.skipIf(!process.env.RUN_LIVE_DRAFT_EVAL)("Q1(c) live first-try pass rate", () => {
  it("23 fixed fact sets with he / she notes (20 + 3 real-shaped)", async () => {
    const rows = await Promise.all(
      SETS.map(async (s) => {
        const facts = draftFacts(s.c, IN);
        let raw: DraftRaw;
        try {
          ({ raw } = await writeDraft({ channel: "whatsapp", tone: "new", kind: "the lead has gone quiet since the last contact and the counsellor is checking in", rowKind: "going_quiet", allowSkip: true, facts, previous: null, todayLabel: "Tuesday 2026-11-10" }));
        } catch (e) {
          return { name: s.name, skipped: false, expectSkip: s.expectSkip, fails: ["schema"], len: 0, text: `${String(e).slice(0, 90)} | ${String((e as { cause?: unknown }).cause ?? "").slice(0, 300).replace(/\s+/g, " ")}` };
        }
        const fails = draftChecks(raw as DraftRaw, facts, { rowKind: "going_quiet", allowSkip: true }).map((f) => f.check);
        const pn = (t: string) => /\b(he|she|his|her|hers|him)\b/i.test(t);
        const where = [pn(raw.text) && "text", pn(raw.why) && "why", pn(raw.followUp.title) && "task", raw.skip && pn(raw.skip.reason) && "skip-reason"].filter(Boolean).join("+");
        return { name: s.name, skipped: !!raw.skip, expectSkip: s.expectSkip, fails: fails.map((f) => (f === "pronoun" ? `pronoun[${where}]` : f)), len: raw.text.length, text: raw.skip ? `SKIP: ${raw.skip.quote} // reason: ${raw.skip.reason}` : `${raw.text} // why: ${raw.why} // task: ${raw.followUp.title}` };
      }),
    );
    const passed = rows.filter((r) => r.fails.length === 0).length;
    const skipRight = rows.filter((r) => r.skipped === r.expectSkip).length;
    console.log(`FIRST-TRY CHECK PASS: ${passed}/${rows.length} (${Math.round((passed / rows.length) * 100)}%)  SKIP DECISION RIGHT: ${skipRight}/${rows.length}\n` + rows.map((r) => `${r.fails.length ? "FAIL " + r.fails.join(",") : "ok"} | skip=${r.skipped}/${r.expectSkip} | ${r.name} | ${r.text}`).join("\n"));
    expect(rows).toHaveLength(SETS.length);
  }, 120_000);
});
