import { describe, expect, it } from "vitest";
import { NotificationTypes } from "./notifications";
import {
  NOTIFICATION_CATEGORIES,
  categoryOrFilter,
  isNotificationCategory,
} from "./notification-categories";

describe("notification categories", () => {
  it("builds a like-filter per prefix", () => {
    expect(categoryOrFilter("leads")).toBe("type.like.lead.*");
    expect(categoryOrFilter("team")).toBe("type.like.invite.*,type.like.team.*");
  });

  it("rejects unknown categories so nothing user-supplied reaches the filter", () => {
    expect(isNotificationCategory("leads")).toBe(true);
    expect(isNotificationCategory("type.eq.x")).toBe(false);
    expect(isNotificationCategory(null)).toBe(false);
  });

  it("covers every notification type the app creates", () => {
    const prefixes = NOTIFICATION_CATEGORIES.flatMap((c) => [...c.prefixes]);
    for (const type of Object.values(NotificationTypes)) {
      expect(prefixes.some((p) => type.startsWith(p)), type).toBe(true);
    }
  });
});
