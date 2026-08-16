import { describe, expect, it } from "vitest";
import { matchDeliveryReports } from "./delivery-match";
import type { ProviderReportRow } from "./provider/types";

function row(overrides: Partial<ProviderReportRow> & { id: string; mobile: string; status: string }): ProviderReportRow {
  return { credit: "1", updated_at: "2026-08-16 10:00:00", message: "Admizz: hello", ...overrides };
}

describe("matchDeliveryReports", () => {
  it("matches a single candidate to a single report row on recipient+body, not on id", () => {
    const candidates = [{ id: "m1", to_phone: "9800000001", body: "Admizz: hello", sent_at: "2026-08-16T09:59:00Z" }];
    const rows = [row({ id: "107644461", mobile: "9800000001", status: "delivered" })];

    const { matches, unresolvedMessageIds } = matchDeliveryReports(candidates, rows);

    expect(unresolvedMessageIds).toEqual([]);
    expect(matches).toEqual([
      { messageId: "m1", outcome: "delivered", providerReportId: "107644461", providerCredit: 1, reportStatus: "delivered" },
    ]);
  });

  it("does not join on id — a report id sharing no relationship to the send id still matches by recipient+body", () => {
    const candidates = [{ id: "m1", to_phone: "9800000001", body: "Admizz: hi", sent_at: "2026-08-16T09:59:00Z" }];
    // id is deliberately unrelated to any send-response id.
    const rows = [row({ id: "999999", mobile: "9800000001", status: "failed", message: "Admizz: hi" })];

    const { matches } = matchDeliveryReports(candidates, rows);
    expect(matches).toEqual([{ messageId: "m1", outcome: "failed", providerReportId: "999999", providerCredit: 1, reportStatus: "failed" }]);
  });

  it("parses the string credit field", () => {
    const candidates = [{ id: "m1", to_phone: "9800000001", body: "Admizz: x", sent_at: "2026-08-16T09:59:00Z" }];
    const rows = [row({ id: "1", mobile: "9800000001", status: "delivered", credit: "3", message: "Admizz: x" })];

    const { matches } = matchDeliveryReports(candidates, rows);
    expect(matches[0].providerCredit).toBe(3);
  });

  it("treats an unparseable credit as null rather than throwing", () => {
    const candidates = [{ id: "m1", to_phone: "9800000001", body: "Admizz: x", sent_at: "2026-08-16T09:59:00Z" }];
    const rows = [row({ id: "1", mobile: "9800000001", status: "delivered", credit: "not-a-number", message: "Admizz: x" })];

    const { matches } = matchDeliveryReports(candidates, rows);
    expect(matches[0].providerCredit).toBeNull();
  });

  it("leaves a candidate unresolved when no report row has arrived yet", () => {
    const candidates = [{ id: "m1", to_phone: "9800000001", body: "Admizz: x", sent_at: "2026-08-16T09:59:00Z" }];
    const { matches, unresolvedMessageIds } = matchDeliveryReports(candidates, []);
    expect(matches).toEqual([]);
    expect(unresolvedMessageIds).toEqual(["m1"]);
  });

  it("leaves a candidate unresolved when the report status is still in-transit (not delivered or failed)", () => {
    const candidates = [{ id: "m1", to_phone: "9800000001", body: "Admizz: x", sent_at: "2026-08-16T09:59:00Z" }];
    const rows = [row({ id: "1", mobile: "9800000001", status: "queued", message: "Admizz: x" })];
    const { matches, unresolvedMessageIds } = matchDeliveryReports(candidates, rows);
    expect(matches).toEqual([]);
    expect(unresolvedMessageIds).toEqual(["m1"]);
  });

  it("does not guard against a malformed updated_at zero-date by throwing", () => {
    const candidates = [
      { id: "m1", to_phone: "9800000001", body: "Admizz: dup", sent_at: "2026-08-16T09:59:00Z" },
      { id: "m2", to_phone: "9800000001", body: "Admizz: dup", sent_at: "2026-08-16T10:05:00Z" },
    ];
    const rows = [
      row({ id: "1", mobile: "9800000001", status: "delivered", message: "Admizz: dup", updated_at: "0000-00-00 00:00:00" }),
      row({ id: "2", mobile: "9800000001", status: "failed", message: "Admizz: dup", updated_at: "0000-00-00 00:00:00" }),
    ];
    expect(() => matchDeliveryReports(candidates, rows)).not.toThrow();
    // Both report rows have the zero-date sentinel — timestamps can't
    // disambiguate, so the whole ambiguous group must stay unresolved.
    const { matches, unresolvedMessageIds } = matchDeliveryReports(candidates, rows);
    expect(matches).toEqual([]);
    expect(unresolvedMessageIds.sort()).toEqual(["m1", "m2"]);
  });

  it("disambiguates two identical recipient+body candidates by nearest timestamp when unambiguous", () => {
    const candidates = [
      { id: "m1", to_phone: "9800000001", body: "Admizz: dup", sent_at: "2026-08-16T09:00:00Z" },
      { id: "m2", to_phone: "9800000001", body: "Admizz: dup", sent_at: "2026-08-16T12:00:00Z" },
    ];
    const rows = [
      row({ id: "1", mobile: "9800000001", status: "delivered", message: "Admizz: dup", updated_at: "2026-08-16 09:01:00" }),
      row({ id: "2", mobile: "9800000001", status: "failed", message: "Admizz: dup", updated_at: "2026-08-16 12:02:00" }),
    ];

    const { matches, unresolvedMessageIds } = matchDeliveryReports(candidates, rows);
    expect(unresolvedMessageIds).toEqual([]);
    expect(matches).toContainEqual({ messageId: "m1", outcome: "delivered", providerReportId: "1", providerCredit: 1, reportStatus: "delivered" });
    expect(matches).toContainEqual({ messageId: "m2", outcome: "failed", providerReportId: "2", providerCredit: 1, reportStatus: "failed" });
  });

  it("leaves an ambiguous group unresolved on a timestamp tie rather than guessing", () => {
    const candidates = [
      { id: "m1", to_phone: "9800000001", body: "Admizz: dup", sent_at: "2026-08-16T09:00:00Z" },
      { id: "m2", to_phone: "9800000001", body: "Admizz: dup", sent_at: "2026-08-16T09:00:00Z" },
    ];
    const rows = [
      row({ id: "1", mobile: "9800000001", status: "delivered", message: "Admizz: dup", updated_at: "2026-08-16 09:00:30" }),
      row({ id: "2", mobile: "9800000001", status: "failed", message: "Admizz: dup", updated_at: "2026-08-16 09:00:30" }),
    ];

    const { matches, unresolvedMessageIds } = matchDeliveryReports(candidates, rows);
    expect(matches).toEqual([]);
    expect(unresolvedMessageIds.sort()).toEqual(["m1", "m2"]);
  });

  it("leaves a candidate unresolved when the recipient+body count of candidates and rows mismatch", () => {
    const candidates = [
      { id: "m1", to_phone: "9800000001", body: "Admizz: dup", sent_at: "2026-08-16T09:00:00Z" },
      { id: "m2", to_phone: "9800000001", body: "Admizz: dup", sent_at: "2026-08-16T09:05:00Z" },
    ];
    // Only ONE report row has arrived so far for two candidates sharing this key.
    const rows = [row({ id: "1", mobile: "9800000001", status: "delivered", message: "Admizz: dup" })];

    const { matches, unresolvedMessageIds } = matchDeliveryReports(candidates, rows);
    expect(matches).toEqual([]);
    expect(unresolvedMessageIds.sort()).toEqual(["m1", "m2"]);
  });

  it("dedups report rows by id across repeated poll windows", () => {
    const candidates = [{ id: "m1", to_phone: "9800000001", body: "Admizz: x", sent_at: "2026-08-16T09:59:00Z" }];
    const rows = [
      row({ id: "1", mobile: "9800000001", status: "delivered", message: "Admizz: x" }),
      row({ id: "1", mobile: "9800000001", status: "delivered", message: "Admizz: x" }),
    ];
    const { matches } = matchDeliveryReports(candidates, rows);
    expect(matches).toHaveLength(1);
  });

  it("matches despite mobile format drift (dial code prefix, whitespace)", () => {
    const candidates = [{ id: "m1", to_phone: "9800000001", body: "Admizz: x", sent_at: "2026-08-16T09:59:00Z" }];
    const rows = [row({ id: "1", mobile: " 977-9800000001", status: "delivered", message: "Admizz: x" })];
    const { matches, unresolvedMessageIds } = matchDeliveryReports(candidates, rows);
    expect(unresolvedMessageIds).toEqual([]);
    expect(matches[0].outcome).toBe("delivered");
  });

  it("ignores a report row missing the message field rather than crashing, and leaves the candidate unresolved", () => {
    const candidates = [{ id: "m1", to_phone: "9800000001", body: "Admizz: x", sent_at: "2026-08-16T09:59:00Z" }];
    const rows: ProviderReportRow[] = [{ id: "1", mobile: "9800000001", status: "delivered", credit: "1" }];
    expect(() => matchDeliveryReports(candidates, rows)).not.toThrow();
    const { matches, unresolvedMessageIds } = matchDeliveryReports(candidates, rows);
    expect(matches).toEqual([]);
    expect(unresolvedMessageIds).toEqual(["m1"]);
  });
});
