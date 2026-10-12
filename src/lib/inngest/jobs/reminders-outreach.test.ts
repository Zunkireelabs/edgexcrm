import { describe, it, expect, vi, beforeEach } from "vitest";

// runOutreachDraftReminders: the "a draft just came due" bell. A text draft has no subject, so it must say "text", not
// "email", and never show a blank / email-flavoured message.

let dueDrafts: Array<Record<string, unknown>>;
const createNotificationMock = vi.fn().mockResolvedValue(null);
const stampedIds: string[][] = [];

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notifications", () => ({
  createNotification: (...a: unknown[]) => createNotificationMock(...a),
  NotificationTypes: { OUTREACH_DRAFT_DUE: "outreach_draft_due" },
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: () => ({
      select: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          lte: () => b,
          is: () => b,
          eq: () => b,
          limit: async () => ({ data: dueDrafts, error: null }),
        };
        return b;
      },
      update: () => ({
        in: async (_col: string, ids: string[]) => {
          stampedIds.push(ids);
          return { error: null };
        },
      }),
    }),
  }),
}));

import { runOutreachDraftReminders } from "./reminders";

const draft = (over: Record<string, unknown>) => ({ id: "d1", lead_id: "l1", tenant_id: "t1", assigned_to: "u1", subject: "Hello", channel: "email", ...over });

beforeEach(() => {
  createNotificationMock.mockClear();
  stampedIds.length = 0;
});

describe("runOutreachDraftReminders", () => {
  it("an email draft keeps the email wording and its subject", async () => {
    dueDrafts = [draft({})];
    expect(await runOutreachDraftReminders()).toEqual({ processed: 1, notified: 1 });
    expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Outreach email due", message: "Hello", link: "/leads/l1" }));
  });

  it("a text draft says text, and never uses the (empty) subject", async () => {
    dueDrafts = [draft({ id: "d2", channel: "sms", subject: "" })];
    await runOutreachDraftReminders();
    expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Outreach text due", message: "A follow-up text is ready to send" }));
  });

  it("a draft with no owner is stamped without a notification, whatever its channel", async () => {
    dueDrafts = [draft({ assigned_to: null, channel: "sms" })];
    expect(await runOutreachDraftReminders()).toEqual({ processed: 1, notified: 0 });
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(stampedIds).toEqual([["d1"]]);
  });
});
