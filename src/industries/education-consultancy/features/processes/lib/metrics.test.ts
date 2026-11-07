import { describe, it, expect } from "vitest";
import { METRIC_REGISTRY, readMetric, stepStatus, formatMinutes } from "./metrics";
import { ADMIZZ_NEW_LEAD_RAW } from "./fixtures";
import { ownerWaitMinutes, percentile } from "./owner-wait";

describe("metrics registry reads the SQL output", () => {
  const r = ADMIZZ_NEW_LEAD_RAW;
  it("matches the mockup numbers for the real Admizz inputs", () => {
    expect(readMetric("new_lead_first_call", "owner_within_5min_pct", r)?.value).toBe(14.5); // 17 of 117
    expect(readMetric("new_lead_first_call", "first_contact_1h_pct", r)?.value).toBe(16.8); // 22 of 131 (the mockup rounds to 17%)
    expect(readMetric("new_lead_first_call", "callbacks_kept_pct", r)?.value).toBe(7.7); // 6 of 78
    expect(readMetric("new_lead_first_call", "reached_qualified_pct", r)?.value).toBe(64.9); // 85 of 131
  });
  it("is null (not 0) without a denominator or a field", () => {
    expect(METRIC_REGISTRY.new_lead_first_call.callbacks_kept_pct.read({ callbacks_booked: 0, callbacks_kept: 0 })).toBeNull();
    expect(METRIC_REGISTRY.dropping_a_student.drops_with_reason_pct.read({ dropped: 0, with_reason: null, reason_field_missing: true })).toBeNull();
    expect(METRIC_REGISTRY.visa_to_enrolled.moved_to_enrolled_pct.read({ moved_to_enrolled: 0, won_not_enrolled: 0 })).toBeNull();
  });
  it("visa_to_enrolled: 0 of 47 is 0%", () => {
    expect(METRIC_REGISTRY.visa_to_enrolled.moved_to_enrolled_pct.read({ moved_to_enrolled: 0, won_not_enrolled: 47 })).toBe(0);
  });
  it("detail lines carry the real counts", () => {
    expect(METRIC_REGISTRY.new_lead_first_call.arrived.detail(r)).toContain("98 website form");
    expect(METRIC_REGISTRY.new_lead_first_call.arrived.detail(r)).toContain("62 arrived outside office hours");
    expect(METRIC_REGISTRY.new_lead_first_call.owner_within_5min_pct.detail(r)).toContain("17 of 117");
  });
});

describe("stepStatus / formatMinutes", () => {
  it(">= targets", () => {
    expect(stepStatus(90, ">=", 90)).toBe("met");
    expect(stepStatus(70, ">=", 90)).toBe("amber");
    expect(stepStatus(17, ">=", 80)).toBe("red");
    expect(stepStatus(null, ">=", 80)).toBe("unknown");
  });
  it("<= targets (zero target: any positive is red)", () => {
    expect(stepStatus(0, "<=", 0)).toBe("met");
    expect(stepStatus(1, "<=", 0)).toBe("red");
    expect(stepStatus(4, "<=", 3)).toBe("amber");
  });
  it("formats minutes", () => {
    expect(formatMinutes(32)).toBe("32 min");
    expect(formatMinutes(114)).toBe("1.9 h");
    expect(formatMinutes(null)).toBe("no data");
  });
});

describe("first-assignment-time rules (TS twin of the SQL)", () => {
  const created = "2026-11-01T10:00:00Z";
  it("takes the earliest of assigned_at and the first assigned_to audit row", () => {
    expect(ownerWaitMinutes({ createdAt: created, assignedAt: "2026-11-01T10:30:00Z", assignedTo: "u", firstAssignAuditAt: "2026-11-01T10:10:00Z" })).toBe(10);
    expect(ownerWaitMinutes({ createdAt: created, assignedAt: null, assignedTo: "u", firstAssignAuditAt: "2026-11-01T10:04:00Z" })).toBe(4);
  });
  it("a lead created already assigned (no timestamps) waits 0", () => {
    expect(ownerWaitMinutes({ createdAt: created, assignedAt: null, assignedTo: "u", firstAssignAuditAt: null })).toBe(0);
  });
  it("a never-assigned lead has no wait", () => {
    expect(ownerWaitMinutes({ createdAt: created, assignedAt: null, assignedTo: null, firstAssignAuditAt: null })).toBeNull();
  });
  it("clamps a timestamp before creation to 0", () => {
    expect(ownerWaitMinutes({ createdAt: created, assignedAt: "2026-11-01T09:59:00Z", assignedTo: "u", firstAssignAuditAt: null })).toBe(0);
  });
  it("percentile_cont-style interpolation", () => {
    expect(percentile([0, 10, 20, 30], 0.5)).toBe(15);
    expect(percentile([0, 10, 20, 30], 0.75)).toBe(22.5);
    expect(percentile([], 0.5)).toBeNull();
  });
});
