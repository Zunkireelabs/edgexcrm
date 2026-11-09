import { describe, expect, it } from "vitest";
import { stripPrivate } from "./privacy";
import { buildNotePrompt } from "./note-extract";

describe("stripPrivate: nothing private reaches a prompt", () => {
  it.each([
    ["call him on 9841234567 tomorrow", "9841234567"],
    ["whatsapp +977 984-123-4567 please", "984-123-4567"],
    ["mail sita.rai@gmail.com the brochure", "sita.rai@gmail.com"],
    ["passport no: PA1234567 expires 2030", "PA1234567"],
    ["passport 12345678", "12345678"],
    ["sent https://drive.google.com/file/d/abc123/view", "drive.google.com"],
    ["scan is at transcript_final.pdf", "transcript_final.pdf"],
  ])("%s", (text, secret) => {
    expect(stripPrivate(text)).not.toContain(secret);
  });
  it("keeps what is fine: names, scores, years, intake, course", () => {
    const t = "Sita wants UK, +2 in 2020, GPA 3.2, IELTS 6.5, Sept 2027 intake, BBA";
    expect(stripPrivate(t)).toBe(t);
  });
});

describe("the note prompt builder", () => {
  it("strips phone, email, passport and links from the note, the name and the current values", () => {
    const { prompt, system } = buildNotePrompt({
      firstName: "Sita",
      note: "she is at 9841234567, sita@x.com, passport PA1234567, form at https://x.co/a, plans UK",
      todayLabel: "Monday 2026-11-09",
      current: { sponsor_name: "reach me on 9812345678" },
      nextStageName: null,
    });
    for (const secret of ["9841234567", "sita@x.com", "PA1234567", "https://x.co/a", "9812345678"]) {
      expect(prompt).not.toContain(secret);
      expect(system).not.toContain(secret);
    }
    expect(prompt).toContain("plans UK");
  });
  it("offers the stage field only when there is a next stage", () => {
    const base = { firstName: "S", note: "n", todayLabel: "t", current: {} };
    expect(buildNotePrompt({ ...base, nextStageName: null }).system).not.toContain("stage:");
    expect(buildNotePrompt({ ...base, nextStageName: "Qualified" }).system).toContain("stage:");
  });
});
