import { describe, it, expect } from "vitest";
import type { DraftContext } from "../server/draft-context";
import { afterGreeting, draftChecks, draftFacts, produceDraft, writeDraft } from "./draft";

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
  // B10: THIN real-shaped sets: one fact (what the lead is interested in) plus unanswered calls, no counsellor notes.
  { name: "thin: UK engineering", expectSkip: false, c: ctx("Sushil", { lead: { ...dest(["UK"], { fieldOfStudy: "Engineering" }), firstName: "Sushil", fullName: "Sushil Test" }, lastCall: { at: new Date(NOW.getTime() - 4 * 86_400_000).toISOString(), outcome: "no_answer" }, notes: [] }) },
  { name: "thin: USA", expectSkip: false, c: ctx("Parash", { lead: { ...dest(["USA"]), firstName: "Parash", fullName: "Parash Test" }, lastCall: { at: new Date(NOW.getTime() - 4 * 86_400_000).toISOString(), outcome: "no_answer" }, notes: [] }) },
  { name: "thin: Australia", expectSkip: false, c: ctx("Rajan", { lead: { ...dest(["Australia"], { fieldOfStudy: "Business" }), firstName: "Rajan", fullName: "Rajan Test" }, lastCall: { at: new Date(NOW.getTime() - 4 * 86_400_000).toISOString(), outcome: "no_answer" }, notes: [] }) },
];

describe.skipIf(!process.env.RUN_LIVE_DRAFT_EVAL)("Q1(c) live first-try pass rate", () => {
  it("fixed fact sets with he / she notes: first-try rate, final rate after the one retry, empty cards", async () => {
    const rows = await Promise.all(
      SETS.map(async (s) => {
        const facts = draftFacts(s.c, IN);
        const attempts: string[] = [];
        const pn = (t: string) => /\b(he|she|his|her|hers|him)\b/i.test(t);
        const write: typeof writeDraft = async (i) => {
          const r = await writeDraft(i);
          const raw = r.raw;
          const where = [pn(raw.text) && "text", pn(raw.why) && "why", pn(raw.followUp.title) && "task", raw.skip && pn(raw.skip.reason) && "skip-reason"].filter(Boolean).join("+");
          const fails = draftChecks(raw, facts, { rowKind: "going_quiet", allowSkip: true }).map((f) => (f.check === "pronoun" ? `pronoun[${where}]` : f.check));
          attempts.push(`${fails.length ? "FAIL " + fails.join(",") : "ok"} :: ${raw.skip ? `SKIP: ${raw.skip.quote} // reason: ${raw.skip.reason}` : `${raw.text} // why: ${raw.why} // task: ${raw.followUp.title}`}`);
          return r;
        };
        const p = await produceDraft({ channel: "whatsapp", tone: "new", kind: "the lead has gone quiet since the last contact and the counsellor is checking in", rowKind: "going_quiet", allowSkip: true, facts, previous: null, todayLabel: "Tuesday 2026-11-10" }, write);
        return { styleFlags: p.styleFlags, text: p.raw?.skip ? "" : (p.raw?.text ?? ""), name: s.name, expectSkip: s.expectSkip, firstOk: p.failed[0]?.length === 0, finalOk: p.raw !== null, skipped: !!p.raw?.skip, firstSkipped: attempts[0]?.includes(":: SKIP"), attempts };
      }),
    );
    const n = rows.length;
    const first = rows.filter((r) => r.firstOk).length;
    const final = rows.filter((r) => r.finalOk).length;
    const empty = n - final;
    const skipRight = rows.filter((r) => r.finalOk && r.skipped === r.expectSkip).length;
    // B9(d): cards that open alike. Warn when 2+ final messages share their first 6 words after the greeting/intro.
    const starts = new Map<string, string[]>();
    for (const r of rows) {
      if (!r.text) continue;
      const k = afterGreeting(r.text, IN.counsellorFirstName).toLowerCase().split(/\s+/).slice(0, 6).join(" ");
      starts.set(k, [...(starts.get(k) ?? []), r.name]);
    }
    const flagged = rows.filter((r) => r.styleFlags?.length);
    const thin = rows.filter((r) => r.name.startsWith("thin:")).map((r) => `THIN FINAL ${r.name}: ${r.finalOk ? r.text : "EMPTY"}${r.styleFlags?.length ? ` [style flags: ${r.styleFlags.join(",")}]` : ""}`);
    const alike = [...starts].filter(([, v]) => v.length > 1).map(([k, v]) => `WARNING: ${v.length} cards start "${k}": ${v.join(", ")}`);
    console.log(alike.join("\n") + (alike.length ? "\n" : "") + thin.join("\n") + `\nSHOWN WITH STYLE FLAGS: ${flagged.length}\n` +
      `FIRST-TRY CHECK PASS: ${first}/${n} (${Math.round((first / n) * 100)}%)  FINAL AFTER RETRY: ${final}/${n} (${Math.round((final / n) * 100)}%)  EMPTY CARDS: ${empty} (of ${n})  SKIP DECISION RIGHT: ${skipRight}/${n}\n` +
        rows.filter((r) => !r.firstOk || !r.finalOk).map((r) => `${r.name} (expectSkip=${r.expectSkip}, final ${r.finalOk ? "ok" : "EMPTY"})\n  ` + r.attempts.join("\n  ")).join("\n"),
    );
    expect(rows).toHaveLength(SETS.length);
  }, 180_000);
});
