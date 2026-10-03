import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";

// stopEnrollmentsOnReply — what a lead's reply does to their running sequences (migration 257).
// Pins: pause is the default, 'end' also skips pending drafts, 'continue' touches nothing, an
// unknown value falls back to pause, a person's earlier pause/unenroll is never overwritten
// (updates are guarded on status='active'), and one failing enrollment doesn't block the rest.

const emitEventMock = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/api/audit", () => ({ emitEvent: (...args: unknown[]) => emitEventMock(...args) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const promoteQueuedMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./queue-next", () => ({ promoteQueuedEnrollment: (...a: unknown[]) => promoteQueuedMock(...a) }));

import { stopEnrollmentsOnReply, normalizeOnReply } from "./stop-on-reply";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface Update {
  table: string;
  patch: Row;
  filters: Array<[string, unknown]>;
}

/** Minimal chainable fake: select/update, eq/in filters, awaited at the end. */
function buildDb(tables: Record<string, Row[]>, opts: { failUpdateFor?: string } = {}) {
  const updates: Update[] = [];

  const db = {
    from(table: string) {
      const rows = tables[table] ?? (tables[table] = []);
      const make = (mode: "select" | "update", patch?: Row) => {
        const filters: Array<[string, unknown]> = [];
        const inFilters: Array<[string, unknown[]]> = [];
        const matches = (r: Row) =>
          filters.every(([k, v]) => r[k] === v) && inFilters.every(([k, vs]) => vs.includes(r[k]));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          eq(col: string, val: unknown) {
            filters.push([col, val]);
            return b;
          },
          in(col: string, vals: unknown[]) {
            inFilters.push([col, vals]);
            return b;
          },
          select() {
            return b;
          },
          then(resolve: (v: { data: unknown; error: unknown }) => void, reject?: (e: unknown) => void) {
            let result: { data: unknown; error: unknown };
            if (mode === "update") {
              updates.push({ table, patch: patch!, filters: [...filters] });
              const idFilter = filters.find(([k]) => k === "id");
              if (opts.failUpdateFor && idFilter?.[1] === opts.failUpdateFor && table === "sequence_enrollments") {
                result = { data: null, error: { message: "update failed" } };
              } else {
                const matched = rows.filter(matches);
                matched.forEach((r) => Object.assign(r, patch));
                result = { data: matched.map((r) => ({ id: r.id })), error: null };
              }
            } else {
              // copies, like a real database read — a later change to the row must not alter what was already read
              result = { data: rows.filter(matches).map((r) => ({ ...r })), error: null };
            }
            Promise.resolve(result).then(resolve, reject);
          },
        };
        return b;
      };
      return {
        select: () => make("select"),
        update: (patch: Row) => make("update", patch),
      };
    },
  };
  return { db: db as unknown as ScopedClient, updates };
}

const P = { tenantId: "t1", leadId: "lead-1", emailId: "email-1" };

beforeEach(() => {
  emitEventMock.mockClear();
  promoteQueuedMock.mockClear();
});

describe("normalizeOnReply", () => {
  it("keeps the three valid values and falls back to pause for anything else", () => {
    expect(normalizeOnReply("pause")).toBe("pause");
    expect(normalizeOnReply("end")).toBe("end");
    expect(normalizeOnReply("continue")).toBe("continue");
    expect(normalizeOnReply(null)).toBe("pause");
    expect(normalizeOnReply(undefined)).toBe("pause");
    expect(normalizeOnReply("PAUSE")).toBe("pause");
    expect(normalizeOnReply("stop")).toBe("pause");
  });
});

describe("stopEnrollmentsOnReply", () => {
  it("pauses an active enrollment by default and records why", async () => {
    const tables: Record<string, Row[]> = {
      sequence_enrollments: [{ id: "e1", sequence_id: "s1", lead_id: "lead-1", status: "active" }],
      email_sequences: [{ id: "s1", on_reply: "pause" }],
    };
    const { db, updates } = buildDb(tables);

    const result = await stopEnrollmentsOnReply(db, P);

    expect(result).toEqual({ paused: 1, ended: 0, kept: 0 });
    expect(tables.sequence_enrollments[0]).toMatchObject({ status: "paused", stop_reason: "replied" });
    expect(tables.sequence_enrollments[0].stopped_at).toEqual(expect.any(String));
    // guarded: only flips a row that is still active
    expect(updates[0].filters).toEqual(expect.arrayContaining([["id", "e1"], ["status", "active"]]));
    expect(emitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sequence.paused_on_reply", entityId: "e1", tenantId: "t1" }),
    );
  });

  it("treats a missing / unknown on_reply as pause", async () => {
    const tables: Record<string, Row[]> = {
      sequence_enrollments: [{ id: "e1", sequence_id: "s1", lead_id: "lead-1", status: "active" }],
      email_sequences: [{ id: "s1", on_reply: null }],
    };
    const { db } = buildDb(tables);
    const result = await stopEnrollmentsOnReply(db, P);
    expect(result.paused).toBe(1);
    expect(tables.sequence_enrollments[0].status).toBe("paused");
  });

  it("'end' unenrolls and skips the pending drafts (never the sent ones)", async () => {
    const tables: Record<string, Row[]> = {
      sequence_enrollments: [{ id: "e1", sequence_id: "s1", lead_id: "lead-1", status: "active" }],
      email_sequences: [{ id: "s1", on_reply: "end" }],
      sequence_step_drafts: [
        { id: "d1", enrollment_id: "e1", status: "pending" },
        { id: "d2", enrollment_id: "e1", status: "sent" },
        { id: "d3", enrollment_id: "other", status: "pending" },
      ],
    };
    const { db } = buildDb(tables);

    const result = await stopEnrollmentsOnReply(db, P);

    expect(result).toEqual({ paused: 0, ended: 1, kept: 0 });
    expect(tables.sequence_enrollments[0]).toMatchObject({ status: "unenrolled", stop_reason: "replied" });
    expect(tables.sequence_step_drafts.map((d) => d.status)).toEqual(["skipped", "sent", "pending"]);
    expect(emitEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: "sequence.ended_on_reply" }));
    // ending frees the lead: a sequence queued behind this one starts
    expect(promoteQueuedMock).toHaveBeenCalledWith("t1", "lead-1");
  });

  it("'continue' leaves the enrollment completely alone", async () => {
    const tables: Record<string, Row[]> = {
      sequence_enrollments: [{ id: "e1", sequence_id: "s1", lead_id: "lead-1", status: "active" }],
      email_sequences: [{ id: "s1", on_reply: "continue" }],
    };
    const { db, updates } = buildDb(tables);

    const result = await stopEnrollmentsOnReply(db, P);

    expect(result).toEqual({ paused: 0, ended: 0, kept: 1 });
    expect(updates).toHaveLength(0);
    expect(tables.sequence_enrollments[0].status).toBe("active");
    expect(emitEventMock).not.toHaveBeenCalled();
  });

  it("ignores enrollments that are not active (already paused / completed / unenrolled) and other leads", async () => {
    const tables: Record<string, Row[]> = {
      sequence_enrollments: [
        { id: "e1", sequence_id: "s1", lead_id: "lead-1", status: "paused" },
        { id: "e2", sequence_id: "s1", lead_id: "lead-1", status: "completed" },
        { id: "e3", sequence_id: "s1", lead_id: "lead-1", status: "unenrolled" },
        { id: "e4", sequence_id: "s1", lead_id: "someone-else", status: "active" },
      ],
      email_sequences: [{ id: "s1", on_reply: "pause" }],
    };
    const { db, updates } = buildDb(tables);

    const result = await stopEnrollmentsOnReply(db, P);

    expect(result).toEqual({ paused: 0, ended: 0, kept: 0 });
    expect(updates).toHaveLength(0);
    expect(tables.sequence_enrollments.map((e) => e.status)).toEqual(["paused", "completed", "unenrolled", "active"]);
  });

  it("does nothing (and counts nothing) when a person changed it between the read and the write", async () => {
    const tables: Record<string, Row[]> = {
      sequence_enrollments: [{ id: "e1", sequence_id: "s1", lead_id: "lead-1", status: "active" }],
      email_sequences: [{ id: "s1", on_reply: "pause" }],
    };
    const { db } = buildDb(tables);
    // the read sees it active, then a rep unenrolls it before our guarded update runs
    const realFrom = db.from.bind(db);
    (db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const builder = realFrom(table) as { select: () => unknown; update: (p: Row) => unknown };
      if (table !== "sequence_enrollments") return builder;
      return {
        select: () => builder.select(),
        update: (p: Row) => {
          tables.sequence_enrollments[0].status = "unenrolled"; // the rep got there first
          return builder.update(p);
        },
      };
    };

    const result = await stopEnrollmentsOnReply(db, P);

    expect(result).toEqual({ paused: 0, ended: 0, kept: 0 });
    expect(tables.sequence_enrollments[0].status).toBe("unenrolled");
    expect(tables.sequence_enrollments[0].stop_reason).toBeUndefined();
    expect(emitEventMock).not.toHaveBeenCalled();
  });

  it("one enrollment failing to update doesn't stop the others", async () => {
    const tables: Record<string, Row[]> = {
      sequence_enrollments: [
        { id: "e1", sequence_id: "s1", lead_id: "lead-1", status: "active" },
        { id: "e2", sequence_id: "s2", lead_id: "lead-1", status: "active" },
      ],
      email_sequences: [
        { id: "s1", on_reply: "pause" },
        { id: "s2", on_reply: "pause" },
      ],
    };
    const { db } = buildDb(tables, { failUpdateFor: "e1" });

    const result = await stopEnrollmentsOnReply(db, P);

    expect(result.paused).toBe(1);
    expect(tables.sequence_enrollments[0].status).toBe("active");
    expect(tables.sequence_enrollments[1].status).toBe("paused");
  });

  it("a lead frozen by the sequence-level 'Pause all' who then replies is marked as replied, so 'Resume all' skips them", async () => {
    const tables: Record<string, Row[]> = {
      sequence_enrollments: [
        { id: "e1", sequence_id: "s1", lead_id: "lead-1", status: "paused", stop_reason: "sequence_paused" },
      ],
      email_sequences: [{ id: "s1", on_reply: "pause" }],
    };
    const { db, updates } = buildDb(tables);

    const result = await stopEnrollmentsOnReply(db, P);

    expect(result.paused).toBe(1);
    expect(tables.sequence_enrollments[0]).toMatchObject({ status: "paused", stop_reason: "replied" });
    // guarded on the state it read: paused AND still the stop-all marker
    expect(updates[0].filters).toEqual(expect.arrayContaining([["id", "e1"], ["status", "paused"], ["stop_reason", "sequence_paused"]]));
  });

  it("a rep's own pause (no stop reason) and an earlier reply stop are never overwritten", async () => {
    const tables: Record<string, Row[]> = {
      sequence_enrollments: [
        { id: "e1", sequence_id: "s1", lead_id: "lead-1", status: "paused", stop_reason: null },
        { id: "e2", sequence_id: "s1", lead_id: "lead-1", status: "paused", stop_reason: "replied" },
      ],
      email_sequences: [{ id: "s1", on_reply: "pause" }],
    };
    const { db, updates } = buildDb(tables);
    const result = await stopEnrollmentsOnReply(db, P);
    expect(result).toEqual({ paused: 0, ended: 0, kept: 0 });
    expect(updates).toHaveLength(0);
  });

  it("is idempotent: handling the same reply twice changes nothing the second time", async () => {
    const tables: Record<string, Row[]> = {
      sequence_enrollments: [{ id: "e1", sequence_id: "s1", lead_id: "lead-1", status: "active" }],
      email_sequences: [{ id: "s1", on_reply: "pause" }],
    };
    const { db } = buildDb(tables);

    const first = await stopEnrollmentsOnReply(db, P);
    const second = await stopEnrollmentsOnReply(db, P);

    expect(first.paused).toBe(1);
    expect(second).toEqual({ paused: 0, ended: 0, kept: 0 });
    expect(emitEventMock).toHaveBeenCalledTimes(1);
  });
});
