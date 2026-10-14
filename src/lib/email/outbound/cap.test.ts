import { describe, it, expect } from "vitest";
import { getDailyCapStatus } from "./cap";
import type { ScopedClient } from "@/lib/supabase/scoped";

// OUTREACH-PHASE2-BRIEF.md §3.1/§5.3 — drip (sequence auto-send) gets
// priority over blasts for the shared daily_send_cap. Pins the mechanism:
// the "drip" caller (no options) always sees the FULL remaining; the
// "blast" caller (reserveForDrip: true) sees remaining minus however many
// auto-send drafts are due right now for that tenant.

interface FakeConfig {
  dailyCap: number;
  sentToday: number;
  autoSendSequenceIds: string[];
  activeEnrollmentIds: string[];
  dueAutoSendDraftCount: number;
}

// every .eq() the email_sequences query made, so a test can pin that only EMAIL sequences reserve headroom
let sequenceEqCalls: Array<[string, unknown]> = [];

function fakeDb(cfg: FakeConfig): ScopedClient {
  sequenceEqCalls = [];
  return {
    from(table: string) {
      if (table === "tenant_email_settings") {
        return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { daily_send_cap: cfg.dailyCap }, error: null }) }) };
      }
      if (table === "email_messages") {
        return {
          select: () => ({
            eq: () => ({ gte: () => Promise.resolve({ data: null, error: null, count: cfg.sentToday }) }),
          }),
        };
      }
      if (table === "email_sequences") {
        return {
          select: () => {
            const result = Promise.resolve({ data: cfg.autoSendSequenceIds.map((id) => ({ id })), error: null });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const chain: any = {
              eq: (col: string, val: unknown) => {
                sequenceEqCalls.push([col, val]);
                return chain;
              },
              then: (resolve: (v: unknown) => void) => result.then(resolve),
            };
            return chain;
          },
        };
      }
      if (table === "sequence_enrollments") {
        return {
          select: () => ({
            in: () => ({ eq: () => Promise.resolve({ data: cfg.activeEnrollmentIds.map((id) => ({ id })), error: null }) }),
          }),
        };
      }
      if (table === "sequence_step_drafts") {
        return {
          select: () => ({
            eq: () => ({
              lte: () => ({ in: () => Promise.resolve({ data: null, error: null, count: cfg.dueAutoSendDraftCount }) }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("getDailyCapStatus — drip-over-blast cap priority", () => {
  it("drip caller (no options) sees the FULL remaining, even with due auto-send drafts outstanding", async () => {
    const db = fakeDb({
      dailyCap: 100,
      sentToday: 20,
      autoSendSequenceIds: ["seq-1"],
      activeEnrollmentIds: ["enr-1"],
      dueAutoSendDraftCount: 30,
    });

    const status = await getDailyCapStatus(db);

    expect(status.remaining).toBe(80);
  });

  it("blast caller (reserveForDrip: true) reserves headroom for due auto-send drafts", async () => {
    const db = fakeDb({
      dailyCap: 100,
      sentToday: 20,
      autoSendSequenceIds: ["seq-1"],
      activeEnrollmentIds: ["enr-1"],
      dueAutoSendDraftCount: 30,
    });

    const status = await getDailyCapStatus(db, { reserveForDrip: true });

    expect(status.remaining).toBe(50); // 100 - 20 sent - 30 reserved for drip
  });

  it("blast caller never goes negative when the reservation exceeds remaining", async () => {
    const db = fakeDb({
      dailyCap: 100,
      sentToday: 90,
      autoSendSequenceIds: ["seq-1"],
      activeEnrollmentIds: ["enr-1"],
      dueAutoSendDraftCount: 50,
    });

    const status = await getDailyCapStatus(db, { reserveForDrip: true });

    expect(status.remaining).toBe(0);
  });

  it("it_agency regression — a tenant with no auto_send sequences reserves nothing for the blast caller", async () => {
    const db = fakeDb({
      dailyCap: 100,
      sentToday: 20,
      autoSendSequenceIds: [], // no auto-send sequences exist for this tenant (e.g. it_agency)
      activeEnrollmentIds: [],
      dueAutoSendDraftCount: 0,
    });

    const status = await getDailyCapStatus(db, { reserveForDrip: true });

    expect(status.remaining).toBe(80);
  });

  it("only EMAIL auto-send sequences reserve headroom: a due text uses SMS credits, not the daily email cap", async () => {
    const db = fakeDb({ dailyCap: 2000, sentToday: 0, autoSendSequenceIds: ["s1"], activeEnrollmentIds: ["e1"], dueAutoSendDraftCount: 5 });
    await getDailyCapStatus(db, { reserveForDrip: true });
    expect(sequenceEqCalls).toContainEqual(["auto_send", true]);
    expect(sequenceEqCalls).toContainEqual(["channel", "email"]);
  });
});
