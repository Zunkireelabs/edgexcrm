import { describe, it, expect, vi, beforeEach } from "vitest";

// OUTREACH-PHASE2-BRIEF.md §5.4 — markDraftSentViaEdgeX is the auto-send
// counterpart to markDraftSent, called by sequence-step-send.ts (a
// tenantId-only Inngest worker context, no AuthContext). Pins: it attributes
// the lead_activities row to the enrollment's assigned_to/enrolled_by (never
// a live session user), sets sent_via='edgex_send' + the email_message_id
// link, and reuses advanceEnrollment exactly as markDraftSent does.

const emitEventMock = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/api/audit", () => ({ emitEvent: (...args: unknown[]) => emitEventMock(...args) }));
vi.mock("@/lib/ai/flag", () => ({ isOutreachDraftEnabledForTenant: vi.fn() }));
vi.mock("@/lib/ai/draft-email", () => ({ draftSequenceEmail: vi.fn() }));

interface DraftRow {
  id: string;
  tenant_id: string;
  enrollment_id: string;
  lead_id: string;
  step_order: number;
  status: string;
  subject: string;
  body_html: string;
  sent_via: string | null;
  sent_activity_id: string | null;
  email_message_id: string | null;
}

interface EnrollmentRow {
  id: string;
  sequence_id: string;
  lead_id: string;
  assigned_to: string | null;
  enrolled_by: string | null;
  status: string;
  current_step_order: number;
}

function buildFakeDb(opts: { draftRow: DraftRow; enrollmentRow: EnrollmentRow; hasNextStep: boolean }) {
  const { draftRow, enrollmentRow, hasNextStep } = opts;
  const draftUpdates: Record<string, unknown>[] = [];
  const enrollmentUpdates: Record<string, unknown>[] = [];
  const activityInserts: Record<string, unknown>[] = [];

  const db = {
    from(table: string) {
      if (table === "sequence_step_drafts") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...draftRow }, error: null }) }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => {
              draftUpdates.push(patch);
              Object.assign(draftRow, patch);
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table === "sequence_enrollments") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...enrollmentRow }, error: null }) }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => {
              enrollmentUpdates.push(patch);
              Object.assign(enrollmentRow, patch);
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table === "lead_activities") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: () => {
                activityInserts.push(row);
                return Promise.resolve({ data: { id: "activity-1" }, error: null });
              },
            }),
          }),
        };
      }
      if (table === "email_sequence_steps") {
        return {
          select: () => ({
            eq: () => ({
              gt: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () =>
                      Promise.resolve({ data: hasNextStep ? { id: "step-2", step_order: 2 } : null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { db, draftUpdates, enrollmentUpdates, activityInserts };
}

function baseDraft(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: "draft-1",
    tenant_id: "tenant-1",
    enrollment_id: "enr-1",
    lead_id: "lead-1",
    step_order: 2,
    status: "pending",
    subject: "Hi {{first_name}}",
    body_html: "<p>Body</p>",
    sent_via: null,
    sent_activity_id: null,
    email_message_id: null,
    ...overrides,
  };
}

function baseEnrollment(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "enr-1",
    sequence_id: "seq-1",
    lead_id: "lead-1",
    assigned_to: "user-1",
    enrolled_by: "user-2",
    status: "active",
    current_step_order: 1,
    ...overrides,
  };
}

describe("markDraftSentViaEdgeX", () => {
  beforeEach(() => {
    emitEventMock.mockClear();
  });

  it("marks the draft sent via edgex_send, stamps the email_message_id link, logs the activity, and completes the enrollment when there's no next step", async () => {
    const { markDraftSentViaEdgeX } = await import("./engine");
    const { db, draftUpdates, enrollmentUpdates, activityInserts } = buildFakeDb({
      draftRow: baseDraft({ step_order: 2 }),
      enrollmentRow: baseEnrollment(),
      hasNextStep: false,
    });

    const result = await markDraftSentViaEdgeX(db, "tenant-1", "draft-1", "message-1");

    expect(result?.activityId).toBe("activity-1");
    expect(draftUpdates[0]).toMatchObject({
      status: "sent",
      sent_via: "edgex_send",
      email_message_id: "message-1",
      sent_activity_id: "activity-1",
    });
    expect(activityInserts[0]).toMatchObject({ user_id: "user-1", lead_id: "lead-1" });
    // advanceEnrollment's completion branch — enrollment update includes 'completed'
    expect(enrollmentUpdates.some((u) => u.status === "completed")).toBe(true);
  });

  it("returns null and writes nothing when the draft is not pending (already sent/skipped)", async () => {
    const { markDraftSentViaEdgeX } = await import("./engine");
    const { db, draftUpdates, enrollmentUpdates, activityInserts } = buildFakeDb({
      draftRow: baseDraft({ status: "sent" }),
      enrollmentRow: baseEnrollment(),
      hasNextStep: false,
    });

    const result = await markDraftSentViaEdgeX(db, "tenant-1", "draft-1", "message-1");

    expect(result).toBeNull();
    expect(draftUpdates).toHaveLength(0);
    expect(enrollmentUpdates).toHaveLength(0);
    expect(activityInserts).toHaveLength(0);
  });

  it("skips the lead_activities insert (but still marks the draft sent) when the enrollment has no assigned_to or enrolled_by", async () => {
    const { markDraftSentViaEdgeX } = await import("./engine");
    const { db, draftUpdates, activityInserts } = buildFakeDb({
      draftRow: baseDraft(),
      enrollmentRow: baseEnrollment({ assigned_to: null, enrolled_by: null }),
      hasNextStep: false,
    });

    const result = await markDraftSentViaEdgeX(db, "tenant-1", "draft-1", "message-1");

    expect(result?.activityId).toBeNull();
    expect(activityInserts).toHaveLength(0);
    expect(draftUpdates[0]).toMatchObject({ status: "sent", sent_activity_id: null });
  });
});
