import { describe, expect, it } from "vitest";
import { BATCH_MAX, batchEntries, batchSummary, channelChip } from "./batch";
import type { DoNextItem } from "./types";

const it_ = (o: Partial<DoNextItem> & { key: string; kind: DoNextItem["kind"] }): DoNextItem => ({
  tier: "now", leadId: o.key.split(":")[1], title: o.key, why: "", chip: { text: "2 days", tone: "neutral" }, tone: "neutral",
  primaryAction: { type: "call", leadId: o.key.split(":")[1], phone: null, leadName: `Lead ${o.key.split(":")[1]}` }, sortKey: { group: 0, at: 0 }, evidenceHref: "/x", ...o,
}) as DoNextItem;

describe("batchEntries", () => {
  it("counts only rows B3 can draft: reply, missing document, overdue call-back; never new leads, tasks, stuck-in-stage", () => {
    const { entries } = batchEntries([
      it_({ key: "reply_waiting:a", kind: "reply_waiting" }),
      it_({ key: "deadline_docs:b", kind: "deadline_docs" }),
      it_({ key: "callback_overdue:c", kind: "callback_overdue" }),
      it_({ key: "new_uncalled:d", kind: "new_uncalled" }),
      it_({ key: "task_due:e", kind: "task_due" }),
      it_({ key: "stuck_in_stage:f", kind: "stuck_in_stage" }),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["reply_waiting", "deadline_docs", "callback_overdue"]);
  });
  it("a grouped row feeds the batch with its REAL leads, not itself", () => {
    const group = it_({ key: "going_quiet:all", kind: "going_quiet", leadId: undefined, primaryAction: { type: "sheet", label: "Open 3" }, children: ["g1", "g2", "g3"].map((id) => it_({ key: `going_quiet:${id}`, kind: "going_quiet" })) });
    const missed = it_({ key: "missed_callbacks:all", kind: "missed_callbacks", leadId: undefined, primaryAction: { type: "sheet", label: "x" }, children: [it_({ key: "callback_overdue:m1", kind: "callback_overdue" })] });
    const { entries, total } = batchEntries([group, missed]);
    expect(entries.map((e) => [e.leadId, e.kind])).toEqual([["g1", "going_quiet"], ["g2", "going_quiet"], ["g3", "going_quiet"], ["m1", "callback_overdue"]]);
    expect(total).toBe(4);
  });
  it("one message per lead: the first row for a lead wins", () => {
    const { entries } = batchEntries([it_({ key: "reply_waiting:a", kind: "reply_waiting" }), it_({ key: "callback_overdue:a", kind: "callback_overdue", leadId: "a" })]);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("reply_waiting");
  });
  it("hidden (snoozed / done) rows and their children are left out", () => {
    const hidden = new Set(["reply_waiting:a", "going_quiet:all"]);
    const group = it_({ key: "going_quiet:all", kind: "going_quiet", leadId: undefined, primaryAction: { type: "sheet", label: "x" }, children: [it_({ key: "going_quiet:g1", kind: "going_quiet" })] });
    expect(batchEntries([it_({ key: "reply_waiting:a", kind: "reply_waiting" }), group], hidden).entries).toEqual([]);
  });
  it("at most 12, with the true total reported", () => {
    const many = Array.from({ length: 15 }, (_, i) => it_({ key: `reply_waiting:l${i}`, kind: "reply_waiting" }));
    const r = batchEntries(many);
    expect(BATCH_MAX).toBe(12);
    expect(r.entries).toHaveLength(12);
    expect(r.total).toBe(15);
  });
  it("the summary line: '4 check-ins, 1 document request, 1 reply'", () => {
    const k = (kind: string, n: number) => Array.from({ length: n }, () => ({ kind })) as never;
    expect(batchSummary([...k("going_quiet", 4), ...k("deadline_docs", 1), ...k("reply_waiting", 1)])).toBe("4 check-ins, 1 document request, 1 reply");
    expect(batchSummary([...k("reply_waiting", 2), ...k("callback_overdue", 1)])).toBe("2 replies, 1 call-back follow-up");
  });
});

describe("P3: the channel chip says only what is true", () => {
  it("all WhatsApp, all email, mixed, none", () => {
    expect(channelChip(["whatsapp", "whatsapp"])).toBe("On WhatsApp");
    expect(channelChip(["email", "email"])).toBe("On email");
    expect(channelChip(["whatsapp", "email"])).toBe("WhatsApp and email");
    expect(channelChip([null, null])).toBeNull();
  });
  it("cards with no way to send don't count", () => {
    expect(channelChip(["whatsapp", null, "whatsapp"])).toBe("On WhatsApp");
  });
  it("never claims 'last replied on'", () => {
    for (const c of [["whatsapp"], ["email"], ["whatsapp", "email"]] as const) expect(channelChip([...c])).not.toMatch(/replied/i);
  });
});
