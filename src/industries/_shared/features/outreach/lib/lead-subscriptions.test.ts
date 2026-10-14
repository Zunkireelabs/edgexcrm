import { describe, it, expect } from "vitest";
import { campaignStatusLabel, endedBecause, toCampaignRows, toQueuedRows, toSequenceRows, type RawEnrollment } from "./lead-subscriptions";

const enr = (over: Partial<RawEnrollment>): RawEnrollment => ({
  id: "e", sequence_id: "s", channel: "email", status: "completed", current_step_order: 3, started_at: "2026-01-01T00:00:00Z",
  completed_at: "2026-02-01T00:00:00Z", stopped_at: null, stop_reason: null, email_sequences: { name: "Welcome" }, ...over,
});

describe("lead subscriptions mapping", () => {
  it("live rows have no end date; past rows end at completed_at, else stopped_at", () => {
    const [live, done, stopped] = toSequenceRows([
      enr({ status: "paused", stop_reason: "sequence_paused" }),
      enr({}),
      enr({ status: "unenrolled", completed_at: null, stopped_at: "2026-03-01T00:00:00Z", stop_reason: "suppressed" }),
    ]);
    expect(live).toMatchObject({ live: true, endedAt: null, stopReason: "sequence_paused" });
    expect(done).toMatchObject({ live: false, endedAt: "2026-02-01T00:00:00Z" });
    expect(stopped).toMatchObject({ live: false, endedAt: "2026-03-01T00:00:00Z" });
  });

  it("is safe with odd data: missing sequence, unknown status / reason / channel", () => {
    const [row] = toSequenceRows([enr({ email_sequences: null, status: "weird", stop_reason: "nope", channel: null })]);
    expect(row).toMatchObject({ sequenceName: "Deleted sequence", status: "unenrolled", live: false, stopReason: null, channel: "email" });
    expect(toQueuedRows([{ id: "q", sequence_id: "s", channel: "sms", created_at: "x", email_sequences: null }])[0]).toMatchObject({
      sequenceName: "Deleted sequence",
      channel: "sms",
    });
  });

  it("explains in plain words why a sequence ended", () => {
    const [finished, removed, replied, unsub, paused] = toSequenceRows([
      enr({}),
      enr({ status: "unenrolled" }),
      enr({ status: "unenrolled", stop_reason: "replied" }),
      enr({ status: "unenrolled", stop_reason: "suppressed" }),
      enr({ status: "unenrolled", stop_reason: "sequence_paused" }),
    ]);
    expect([finished, removed, replied, unsub, paused].map(endedBecause)).toEqual([
      "Finished all steps",
      "Removed from the sequence",
      "Stopped — the lead replied",
      "Stopped — unsubscribed or bounced",
      "Stopped — the sequence was paused",
    ]);
  });

  it("campaigns: names looked up (fallback when the campaign is gone), newest first across email and SMS", () => {
    const rows = toCampaignRows(
      [{ id: "m1", source_id: "b1", status: "sent", sent_at: "2026-05-01T00:00:00Z", created_at: "2026-04-30T00:00:00Z" }, { id: "m2", source_id: "gone", status: "queued", sent_at: null, created_at: "2026-01-01T00:00:00Z" }],
      [{ id: "t1", blast_id: "sb1", status: "delivered", sent_at: "2026-06-01T00:00:00Z", created_at: "2026-06-01T00:00:00Z" }],
      [{ id: "b1", name: "Spring" }],
      [{ id: "sb1", name: "Reminder" }],
    );
    expect(rows.map((r) => [r.id, r.name, r.at])).toEqual([
      ["t1", "Reminder", "2026-06-01T00:00:00Z"],
      ["m1", "Spring", "2026-05-01T00:00:00Z"],
      ["m2", "Email campaign", "2026-01-01T00:00:00Z"],
    ]);
    expect(["delivered", "submitted", "deferred", "suppressed", "bounced", "failed", "other"].map(campaignStatusLabel)).toEqual([
      "Delivered", "Sent", "Waiting to send", "Not sent — unsubscribed", "Bounced", "Failed", "other",
    ]);
  });
});

describe("campaign name when the campaign was deleted", () => {
  it("uses the email subject / the start of the text, and marks it deleted; a live campaign keeps its name", () => {
    const rows = toCampaignRows(
      [
        { id: "m1", source_id: "gone", subject: "  Your   offer\nletter is ready ", status: "sent", sent_at: "2026-05-02T00:00:00Z", created_at: "x" },
        { id: "m2", source_id: "b1", subject: "ignored", status: "sent", sent_at: "2026-05-01T00:00:00Z", created_at: "x" },
      ],
      [{ id: "t1", blast_id: "gone", body: "ADMIZZ: " + "a".repeat(100), status: "delivered", sent_at: "2026-05-03T00:00:00Z", created_at: "x" }],
      [{ id: "b1", name: "Spring" }],
      [],
    );
    expect(rows.map((r) => [r.id, r.name, r.campaignDeleted])).toEqual([
      ["t1", `ADMIZZ: ${"a".repeat(51)}…`, true],
      ["m1", "Your offer letter is ready", true],
      ["m2", "Spring", false],
    ]);
  });
});
