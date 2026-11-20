import { describe, expect, it } from "vitest";
import { attendanceMeaningful, buildTeam, personFromStats, type StatsRow } from "./stats";

const row = (user_id: string, destination: string, received: number, progressed: number, extra: Partial<StatsRow> = {}): StatsRow => ({
  user_id, destination, received, progressed, speed_n: 0, median_first_contact_min: null, flag_7d: null, ...extra,
});

describe("personFromStats", () => {
  const rows = [row("a", "*", 100, 30, { speed_n: 12, median_first_contact_min: 22, flag_7d: "amber" }), row("a", "Australia", 40, 15), row("b", "*", 5, 1)];
  it("splits overall, per-destination and the 7-day flag", () => {
    expect(personFromStats(rows, "a")).toEqual({
      overall: { received: 100, progressed: 30, speedN: 12, medianFirstContactMin: 22 },
      byDestination: { Australia: { received: 40, progressed: 15 } },
      flag7d: "amber",
    });
  });
  it("a person with no stats row is all zeros (a newcomer), not an error", () => {
    expect(personFromStats(rows, "zed").overall).toEqual({ received: 0, progressed: 0, speedN: 0, medianFirstContactMin: null });
  });
});

describe("buildTeam (sparse tenants)", () => {
  it("sums the pool's own rows; ignores people outside the pool", () => {
    const rows = [row("a", "*", 100, 30), row("b", "*", 50, 10), row("x", "*", 999, 999), row("a", "UK", 10, 4), row("b", "UK", 10, 1)];
    const t = buildTeam(rows, ["a", "b"]);
    expect(t.overall).toEqual({ received: 150, progressed: 40 });
    expect(t.byDestination).toEqual({ UK: { received: 20, progressed: 5 } });
  });
  it("team speed is the median of people who have samples; none → null", () => {
    const rows = [row("a", "*", 1, 0, { speed_n: 9, median_first_contact_min: 20 }), row("b", "*", 1, 0, { speed_n: 9, median_first_contact_min: 60 }), row("c", "*", 1, 0)];
    expect(buildTeam(rows, ["a", "b", "c"]).medianFirstContactMin).toBe(40);
    expect(buildTeam([row("c", "*", 1, 0)], ["c"]).medianFirstContactMin).toBeNull();
  });
  it("an empty tenant is all zeros", () => {
    expect(buildTeam([], ["a"])).toEqual({ byDestination: {}, overall: { received: 0, progressed: 0 }, medianFirstContactMin: null });
  });
});

describe("attendanceMeaningful", () => {
  it("Admizz today (1 record in 30 days) does not use attendance", () => {
    expect(attendanceMeaningful(["a"])).toBe(false);
  });
  it("needs 30 records AND 3 people", () => {
    expect(attendanceMeaningful(Array(30).fill("a"))).toBe(false);
    expect(attendanceMeaningful([...Array(10).fill("a"), ...Array(10).fill("b"), ...Array(10).fill("c")])).toBe(true);
    expect(attendanceMeaningful([...Array(29).fill("a"), "b", "c"].slice(0, 29))).toBe(false);
  });
});
