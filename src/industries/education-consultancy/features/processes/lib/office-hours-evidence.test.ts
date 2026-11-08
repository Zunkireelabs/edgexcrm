import { describe, expect, it } from "vitest";
import { describeEvidence, TIME_OPTIONS, timeLabel } from "./office-hours-evidence";

const HOURS = [0, 0, 0, 0, 0, 0, 0, 0, 50, 400, 700, 800, 500, 600, 750, 700, 650, 300, 40, 0, 0, 0, 0, 0];

describe("describeEvidence", () => {
  it("the real Admizz counts read as one honest sentence", () => {
    expect(describeEvidence([1533, 1264, 1613, 1513, 1548, 801, 11], HOURS)).toBe(
      "Your team logged 801 to 1,613 calls and notes on each day from Sunday to Friday, and 11 on Saturdays. Most of the work happens between 9 am and 6 pm.",
    );
  });
  it("a single quiet day plus a closed day are both named", () => {
    expect(describeEvidence([2, 500, 520, 480, 510, 495, 1], HOURS)).toContain("500 to 520".replace("500", "480"));
    expect(describeEvidence([2, 500, 520, 480, 510, 495, 1], HOURS)).toContain("2 on Sundays and 1 on Saturdays");
  });
  it("nothing logged -> no sentence", () => {
    expect(describeEvidence([0, 0, 0, 0, 0, 0, 0], Array(24).fill(0))).toBeNull();
  });
});

describe("time options", () => {
  it("30-minute steps from midnight to midnight", () => {
    expect(TIME_OPTIONS[0]).toBe(0);
    expect(TIME_OPTIONS.at(-1)).toBe(1440);
    expect(TIME_OPTIONS).toHaveLength(49);
  });
  it("labels", () => {
    expect([0, 540, 570, 720, 1080, 1050, 1440].map(timeLabel)).toEqual(["12:00 am", "9:00 am", "9:30 am", "12:00 pm", "6:00 pm", "5:30 pm", "12:00 am"]);
  });
});
