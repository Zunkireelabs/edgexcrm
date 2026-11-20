import { describe, it, expect } from "vitest";
import { dueLabel, lastTouchCard, activityTime } from "../../record-preview/lib/labels";
import { readyCard, shortDate } from "../../record-preview/lib/readiness";

const NOW = new Date(2026, 10, 11, 12, 0, 0);
const d = (m: number, day: number) => new Date(2026, m - 1, day, 12).toISOString();

describe("one date format on the lead page: month first ('Nov 5')", () => {
  it("shortDate", () => {
    expect(shortDate(d(11, 5), "md")).toBe("Nov 5");
    expect(shortDate(d(11, 5))).toBe("5 Nov"); // the record preview keeps day first
  });
  it("Highlights: Last touch 'Added Nov 5', Ready 'Consent signed Nov 3'", () => {
    const card = lastTouchCard({ lastTouchedAt: null, createdAt: d(11, 5), kind: null, who: null, onHold: false, followUpLabel: null, staleDays: 3, now: NOW, dateFormat: "md" });
    expect(card.sub).toBe("Added Nov 5");
    expect(readyCard({ ready: true, items: [], consentSignedAt: d(11, 3), hasActiveConsentTemplate: true, feeStatus: "paid", dateFormat: "md" }).sub).toBe("Consent signed Nov 3 · Pre-app fee paid");
  });
  it("due dates and activity times", () => {
    expect(dueLabel("2026-11-14", NOW, "md")).toEqual({ text: "Sat Nov 14", overdue: false });
    expect(dueLabel("2026-11-25", NOW, "md")).toEqual({ text: "Nov 25", overdue: false });
    expect(activityTime(d(10, 19), NOW, "md")).toBe("Oct 19");
  });
});
