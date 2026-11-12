import { describe, it, expect } from "vitest";
import type { LeadActivity } from "@/lib/supabase/queries";
import { chipCounts, dayLabel, filterFeed, groupByDay, mergeFeed, type FeedInputs } from "./activity-merge";

// Local-time constructors so the tests hold in any timezone.
const at = (m: number, d: number, h = 12, min = 0) => new Date(2026, m - 1, d, h, min).toISOString();
const NOW = new Date(2026, 10, 12, 18, 0); // 12 Nov 2026, local

const names: Record<string, string> = { u1: "Farhan Ali", u2: "Gita Karki" };
const nameOf = (id: string | null | undefined, fb?: string | null) => (id ? names[id] ?? fb ?? null : fb ?? null);

function audit(over: Partial<LeadActivity> & { id: string; created_at: string }): LeadActivity {
  return { action: "update", entity_type: "lead", changes: {}, user_id: "u2", ...over } as LeadActivity;
}

const base: FeedInputs = {
  notes: [], logged: [], emails: [], audits: [], leadCreatedAt: at(10, 19), sourceLabel: "Website form", nameOf,
};

describe("mergeFeed", () => {
  it("ALWAYS has the creation event, even for a lead with no audit rows", () => {
    const feed = mergeFeed(base);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ kind: "created", verb: "created the lead", source: "Website form", at: base.leadCreatedAt });
  });

  it("never has two creation events: an audit creation row wins over the synthetic one", () => {
    const feed = mergeFeed({ ...base, audits: [audit({ id: "a1", action: "created", created_at: at(10, 19, 9) })] });
    expect(feed.filter((f) => f.kind === "created")).toHaveLength(1);
    expect(feed.find((f) => f.kind === "created")?.actor_name).toBe("Gita Karki");
  });

  it("merges notes, calls, meetings, emails, stage moves, assignments and check-ins newest first", () => {
    const feed = mergeFeed({
      ...base,
      notes: [
        { id: "n1", user_id: "u1", user_email: "f@x", content: "<p>Prefers Sydney</p>", created_at: at(11, 9) },
        { id: "n2", user_id: "u2", user_email: "g@x", content: "[CHECK-IN] Visited on 6 Nov at 14:55 — Walk-in visit", created_at: at(11, 6) },
      ],
      logged: [
        { id: "l1", user_id: "u1", activity_type: "call", subject: null, description: "Interested", call_outcome: "connected", duration_minutes: 5, email_subject: null, email_body: null, created_at: at(11, 10) },
        { id: "l2", user_id: "u1", activity_type: "meeting", subject: "Campus visit", description: null, call_outcome: null, duration_minutes: null, email_subject: null, email_body: null, created_at: at(11, 8) },
        { id: "l3", user_id: "u1", activity_type: "email", subject: null, description: null, call_outcome: null, duration_minutes: null, email_subject: "Fees", email_body: null, created_at: at(11, 7) },
      ],
      emails: [{ id: "e1", direction: "outbound", from_email: "f@x", from_name: "Farhan", subject: "Next steps", sent_at: at(11, 4), received_at: null, sender_user_id: "u1" }],
      audits: [
        audit({ id: "a1", created_at: at(11, 5), changes: { stage_id: { old: "a", new: "Prospects" } } }),
        audit({ id: "a2", created_at: at(11, 3), changes: { assigned_to: { old: null, new: "u1" } } }),
        audit({ id: "a3", action: "lead.note_added", entity_type: "note", created_at: at(11, 9) }), // replaced by the real note
      ],
    });
    expect(feed.map((f) => f.id)).toEqual(["act-l1", "note-n1", "act-l2", "act-l3", "note-n2", "audit-a1", "email-e1", "audit-a2", "created-synthetic"]);
    expect(feed.find((f) => f.id === "audit-a3")).toBeUndefined();
    expect(feed.find((f) => f.id === "note-n1")).toMatchObject({ kind: "note", snippet: "Prefers Sydney", actor_name: "Farhan Ali" });
    expect(feed.find((f) => f.id === "note-n2")).toMatchObject({ kind: "checkin", verb: "checked in · Walk-in visit" });
    expect(feed.find((f) => f.id === "act-l1")?.verb).toBe("logged a call · Connected · 5m");
    expect(feed.find((f) => f.id === "audit-a2")).toMatchObject({ kind: "assigned", object: "Farhan Ali" });
  });

  it("counts per chip, and the All count is every item (this is the Activity tab's count)", () => {
    const feed = mergeFeed({
      ...base,
      notes: [
        { id: "n1", user_id: "u1", user_email: "f@x", content: "A note", created_at: at(11, 9) },
        { id: "n2", user_id: "u2", user_email: "g@x", content: "[CHECK-IN] Visited on 6 Nov at 14:55", created_at: at(11, 6) },
      ],
      logged: [{ id: "l1", user_id: "u1", activity_type: "call", subject: null, description: null, call_outcome: null, duration_minutes: null, email_subject: null, email_body: null, created_at: at(11, 10) }],
      emails: [{ id: "e1", direction: "inbound", from_email: "s@x", from_name: "Sita", subject: "Hi", sent_at: null, received_at: at(11, 4), sender_user_id: null }],
      audits: [
        audit({ id: "a1", created_at: at(11, 5), changes: { stage_id: { old: "a", new: "Prospects" } } }),
        audit({ id: "a2", created_at: at(11, 3), action: "consent.signed" }),
      ],
    });
    expect(chipCounts(feed)).toEqual({ all: feed.length, calls: 1, notes: 1, emails: 1, stage: 1, checkins: 1 });
    expect(feed).toHaveLength(7); // note, check-in, call, email, stage, consent, created
    expect(filterFeed(feed, "all")).toHaveLength(7);
    expect(filterFeed(feed, "checkins").map((f) => f.id)).toEqual(["note-n2"]);
    expect(filterFeed(feed, "calls").map((f) => f.id)).toEqual(["act-l1"]);
  });

  it("skips an email with no timestamp instead of crashing", () => {
    const feed = mergeFeed({ ...base, emails: [{ id: "e1", direction: "outbound", from_email: "f@x", from_name: null, subject: "x", sent_at: null, received_at: null, sender_user_id: null }] });
    expect(feed).toHaveLength(1);
  });
});

describe("grouping", () => {
  it("labels Today / Yesterday / dates, newest group first", () => {
    expect(dayLabel(at(11, 12, 10), NOW)).toBe("Today");
    expect(dayLabel(at(11, 11, 10), NOW)).toBe("Yesterday");
    expect(dayLabel(at(11, 6, 10), NOW)).toBe("Nov 6");
    expect(dayLabel(new Date(2025, 11, 30).toISOString(), NOW)).toBe("Dec 30, 2025");
    const feed = mergeFeed({
      ...base,
      notes: [
        { id: "n1", user_id: "u1", user_email: "", content: "now", created_at: at(11, 12, 10) },
        { id: "n2", user_id: "u1", user_email: "", content: "then", created_at: at(11, 6, 15) },
      ],
    });
    const groups = groupByDay(feed, NOW);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Nov 6", "Oct 19"]);
  });
});
