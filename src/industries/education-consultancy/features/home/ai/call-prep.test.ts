import { describe, expect, it } from "vitest";
import { buildKbPrompt, buildOpeningPrompt, kbRestatementOk, openingOk } from "./call-prep";

const IN = { company: "Admizz", counsellorFirstName: "Rita", leadFirstName: "Sujan", todayLabel: "Monday 2026-11-09", facts: ["Field of study the lead asked about: Nursing", "Country the lead asked about: Australia", "Intake: February 2027", "The enquiry arrived 3 days ago", "Form answer, mobile: 9841234567", "Form answer, note: mail sujan@x.com"] };

describe("opening line prompt: S1–S4 apply", () => {
  const { system, prompt } = buildOpeningPrompt(IN);
  it("carries the company, the Home first name and the lead's first name", () => {
    expect(prompt).toContain("Company: Admizz");
    expect(prompt).toContain("Counsellor first name: Rita");
    expect(prompt).toContain("Lead first name: Sujan");
  });
  it("no profile name: no name, never an email", () => {
    const p = buildOpeningPrompt({ ...IN, counsellorFirstName: null }).prompt;
    expect(p).toContain("do not give a name");
    expect(p).not.toContain("Counsellor first name");
  });
  it("tells the model: company name, names only, no invented timing, no invented numbers", () => {
    expect(system).toContain("from the Company");
    expect(system).toContain("never 'our office'");
    expect(system).toContain("never use he, she");
    expect(system).toContain("unless a fact states that timing");
    expect(system).toContain("must appear in the facts");
  });
  it("never carries a phone or email", () => {
    expect(prompt).not.toMatch(/9841234567|sujan@x\.com/);
  });
});

describe("openingOk", () => {
  const facts = [...IN.facts, "Company: Admizz"];
  it("a clean line passes, with the real timing allowed", () => {
    expect(openingOk("Hi Sujan, this is Rita from Admizz. You asked about nursing in Australia for February. Have you got a few minutes?", facts)).toBe(true);
    expect(openingOk("Hi Sujan, you enquired 3 days ago about nursing.", facts)).toBe(true);
  });
  it("refuses invented numbers, 'yesterday' without a fact, and he/she", () => {
    expect(openingOk("Hi Sujan, have you got five minutes? It takes 10 minutes.", facts)).toBe(false);
    expect(openingOk("Hi Sujan, you enquired yesterday.", facts)).toBe(false);
    expect(openingOk("Hi Sujan, tell her about nursing.", facts)).toBe(false);
  });
});

describe("knowledge-base restatement: the model may only restate the chunk", () => {
  const passage = "4 partner universities take Bachelor of Nursing students in February 2027. All ask for IELTS 7.0 with no band below 6.5.";
  it("numbers in the restatement must be in the passage", () => {
    expect(kbRestatementOk("4 partners take nursing students in February 2027, all asking for IELTS 7.0.", passage)).toBe(true);
    expect(kbRestatementOk("5 partners take nursing students.", passage)).toBe(false);
    expect(kbRestatementOk("They ask for IELTS 6.0.", passage)).toBe(false);
  });
  it("the prompt carries only the passage, course and country (stripped), and asks for null when nothing is useful", () => {
    const { system, prompt } = buildKbPrompt({ passage: "Call the office on 9841234567 or mail info@uni.edu", course: "Nursing", country: "Australia" });
    expect(prompt).not.toMatch(/9841234567|info@uni\.edu/);
    expect(prompt).toContain("Course: Nursing");
    expect(system).toContain("Use ONLY the passage");
    expect(system).toContain("return null");
  });
});
