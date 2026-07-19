import { describe, it, expect } from "vitest";
import {
  describeApprovalRows,
  collectApprovalRefs,
  resolveRowDisplay,
  refKey,
  leadLabel,
  assigneeLabel,
  formatRelativeTime,
  buildUndoDescription,
  type PreviewRow,
  type ResolvedRef,
} from "./approval-resolve";

describe("describeApprovalRows — every id field resolves via a ref, never a raw string", () => {
  it("create_task: assigneeId and leadId become refs", () => {
    const rows = describeApprovalRows("create_task", {
      title: "Follow up",
      assigneeId: "11111111-1111-1111-1111-111111111111",
      leadId: "22222222-2222-2222-2222-222222222222",
    });
    const assignee = rows.find((r) => r.label === "Assignee");
    const lead = rows.find((r) => r.label === "Lead");
    expect(assignee?.ref).toEqual({ kind: "assignee", id: "11111111-1111-1111-1111-111111111111" });
    expect(assignee?.value).toBeUndefined();
    expect(lead?.ref).toEqual({ kind: "lead", id: "22222222-2222-2222-2222-222222222222" });
    expect(lead?.value).toBeUndefined();
  });

  it("create_task: assignee falls back to the static 'You' label when assigneeId is absent", () => {
    const rows = describeApprovalRows("create_task", { title: "Follow up" });
    const assignee = rows.find((r) => r.label === "Assignee");
    expect(assignee?.ref).toBeUndefined();
    expect(assignee?.value).toBe("You");
  });

  it("update_lead_stage: leadId becomes a ref; stageName stays a static value (out of scope)", () => {
    const rows = describeApprovalRows("update_lead_stage", {
      leadId: "22222222-2222-2222-2222-222222222222",
      stageName: "Qualified",
    });
    expect(rows.find((r) => r.label === "Lead")?.ref).toEqual({ kind: "lead", id: "22222222-2222-2222-2222-222222222222" });
    expect(rows.find((r) => r.label === "Stage")?.value).toBe("Qualified");
  });

  it("assign_lead: leadId and assigneeId both become refs", () => {
    const rows = describeApprovalRows("assign_lead", {
      leadId: "22222222-2222-2222-2222-222222222222",
      assigneeId: "11111111-1111-1111-1111-111111111111",
    });
    expect(rows.find((r) => r.label === "Lead")?.ref).toEqual({ kind: "lead", id: "22222222-2222-2222-2222-222222222222" });
    expect(rows.find((r) => r.label === "Assignee")?.ref).toEqual({
      kind: "assignee",
      id: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("assign_lead: assignee falls back to the static '—' value when assigneeId is absent", () => {
    const rows = describeApprovalRows("assign_lead", { leadId: "22222222-2222-2222-2222-222222222222" });
    const assignee = rows.find((r) => r.label === "Assignee");
    expect(assignee?.ref).toBeUndefined();
    expect(assignee?.value).toBe("—");
  });

  it("create_lead_note: leadId becomes a ref", () => {
    const rows = describeApprovalRows("create_lead_note", {
      leadId: "22222222-2222-2222-2222-222222222222",
      content: "Called, left voicemail",
    });
    expect(rows.find((r) => r.label === "Lead")?.ref).toEqual({ kind: "lead", id: "22222222-2222-2222-2222-222222222222" });
  });

  it("create_knowledge_item: knowledgeBaseId becomes a ref", () => {
    const rows = describeApprovalRows("create_knowledge_item", {
      knowledgeBaseId: "33333333-3333-3333-3333-333333333333",
      title: "Refund policy",
      content: "...",
    });
    expect(rows.find((r) => r.label === "Knowledge base")?.ref).toEqual({
      kind: "knowledge_base",
      id: "33333333-3333-3333-3333-333333333333",
    });
  });

  it("undo_lead_action: always a ref with id: null (the 'most recent' sentinel) — BRIEF-PHASE-4F removed actionId, there is no other value it could ever be", () => {
    const rows = describeApprovalRows("undo_lead_action", {});
    expect(rows).toEqual([{ label: "Action", ref: { kind: "undo_action", id: null }, long: true }]);
  });

  it("falls back to a generic key/value dump for a tool with no describer, no refs invented", () => {
    const rows = describeApprovalRows("some_future_tool", { foo: "bar", count: 3 });
    expect(rows.every((r) => r.ref === undefined)).toBe(true);
  });
});

describe("collectApprovalRefs", () => {
  it("dedupes refs by kind+id", () => {
    const rows: PreviewRow[] = [
      { label: "Lead", ref: { kind: "lead", id: "a" } },
      { label: "Lead again", ref: { kind: "lead", id: "a" } },
      { label: "Assignee", ref: { kind: "assignee", id: "b" } },
    ];
    expect(collectApprovalRefs(rows)).toEqual([
      { kind: "lead", id: "a" },
      { kind: "assignee", id: "b" },
    ]);
  });

  it("ignores rows without a ref", () => {
    const rows: PreviewRow[] = [{ label: "Title", value: "x" }];
    expect(collectApprovalRefs(rows)).toEqual([]);
  });
});

describe("resolveRowDisplay", () => {
  it("renders a static value directly when the row has no ref", () => {
    expect(resolveRowDisplay({ label: "Title", value: "Follow up" }, {})).toEqual({ text: "Follow up", tone: "normal" });
  });

  it("renders a loading state while the ref hasn't resolved yet", () => {
    const row: PreviewRow = { label: "Lead", ref: { kind: "lead", id: "a" } };
    expect(resolveRowDisplay(row, {})).toEqual({ text: "Resolving…", tone: "loading" });
  });

  it("renders the resolved label once available", () => {
    const row: PreviewRow = { label: "Lead", ref: { kind: "lead", id: "a" } };
    const resolved: Record<string, ResolvedRef> = { [refKey(row.ref!)]: { label: "Riya Sharma (ADM-001)" } };
    expect(resolveRowDisplay(row, resolved)).toEqual({ text: "Riya Sharma (ADM-001)", tone: "normal" });
  });

  it("renders a prominent NOT FOUND with the raw id still visible when the ref can't resolve", () => {
    const row: PreviewRow = { label: "Lead", ref: { kind: "lead", id: "eef51732-1fbf-485a-89fc-2777b9097985" } };
    const resolved: Record<string, ResolvedRef> = { [refKey(row.ref!)]: { notFound: true } };
    expect(resolveRowDisplay(row, resolved)).toEqual({
      text: "NOT FOUND (eef51732-1fbf-485a-89fc-2777b9097985)",
      tone: "notFound",
    });
  });

  it("renders a NOT FOUND without a raw id for the undo_action 'no prior action' case", () => {
    const row: PreviewRow = { label: "Action", ref: { kind: "undo_action", id: null } };
    const resolved: Record<string, ResolvedRef> = { [refKey(row.ref!)]: { notFound: true } };
    expect(resolveRowDisplay(row, resolved)).toEqual({ text: "NOT FOUND (no matching action)", tone: "notFound" });
  });
});

describe("leadLabel", () => {
  it("combines name and display id", () => {
    expect(leadLabel({ first_name: "Riya", last_name: "Sharma", display_id: "ADM-001" })).toBe("Riya Sharma (ADM-001)");
  });

  it("falls back to display id alone when there's no name", () => {
    expect(leadLabel({ first_name: null, last_name: null, display_id: "ADM-001" })).toBe("ADM-001");
  });

  it("falls back to name alone when there's no display id (non-education tenant)", () => {
    expect(leadLabel({ first_name: "Riya", last_name: "Sharma", display_id: null })).toBe("Riya Sharma");
  });

  it("falls back to '(no name)' when neither is present", () => {
    expect(leadLabel({ first_name: null, last_name: null, display_id: null })).toBe("(no name)");
  });
});

describe("assigneeLabel", () => {
  it("prefers the name", () => {
    expect(assigneeLabel("Anish Balami", "anish@example.com")).toBe("Anish Balami");
  });

  it("falls back to email when there's no name", () => {
    expect(assigneeLabel(null, "anish@example.com")).toBe("anish@example.com");
  });

  it("falls back to 'Unknown' when neither is present", () => {
    expect(assigneeLabel(null, null)).toBe("Unknown");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");

  it("just now", () => {
    expect(formatRelativeTime("2026-07-19T11:59:30.000Z", now)).toBe("just now");
  });

  it("minutes ago", () => {
    expect(formatRelativeTime("2026-07-19T11:55:00.000Z", now)).toBe("5 minutes ago");
  });

  it("1 hour ago (singular)", () => {
    expect(formatRelativeTime("2026-07-19T11:00:00.000Z", now)).toBe("1 hour ago");
  });

  it("hours ago", () => {
    expect(formatRelativeTime("2026-07-19T09:00:00.000Z", now)).toBe("3 hours ago");
  });

  it("yesterday", () => {
    expect(formatRelativeTime("2026-07-18T12:00:00.000Z", now)).toBe("yesterday");
  });

  it("days ago", () => {
    expect(formatRelativeTime("2026-07-15T12:00:00.000Z", now)).toBe("4 days ago");
  });
});

describe("buildUndoDescription", () => {
  it("describes a stage change without any ids", () => {
    const sentence = buildUndoDescription({
      kind: "stage",
      leadLabel: "Riya Sharma (ADM-001)",
      from: "Pre-qualified",
      to: "Qualified",
      relativeTime: "5 minutes ago",
    });
    expect(sentence).toBe("Undo: stage change on Riya Sharma (ADM-001), Pre-qualified → Qualified, 5 minutes ago");
  });

  it("describes an assignment change without any ids", () => {
    const sentence = buildUndoDescription({
      kind: "assignment",
      leadLabel: "Riya Sharma (ADM-001)",
      from: "Unassigned",
      to: "Anish Balami",
      relativeTime: "2 hours ago",
    });
    expect(sentence).toBe("Undo: assignment change on Riya Sharma (ADM-001), Unassigned → Anish Balami, 2 hours ago");
  });

  it("describes a non-undoable action generically", () => {
    const sentence = buildUndoDescription({ kind: "generic", toolId: "create_task", relativeTime: "1 hour ago" });
    expect(sentence).toBe('Undo: "create_task" action, 1 hour ago (not undoable)');
  });
});
