// @vitest-environment jsdom
//
// Client request (Manish, 2026-11-03): the System Activity line for a stage move must say who the lead is
// assigned to. A reassignment in the same move wins; otherwise the holder recorded at move time; rows from
// before that was recorded stay exactly as they were.
import { describe, it, expect, vi } from "vitest";
import React from "react";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/industries/_shared/features/email/hooks/use-connected-inboxes", () => ({ useConnectedInboxes: () => ({ inboxes: [] }) }));
vi.mock("@/industries/_shared/features/outreach/ui/lead-cadence-strip", () => ({ LeadCadenceStrip: () => null }));
vi.mock("@/components/dashboard/tasks/task-list", () => ({ TaskList: () => null }));
vi.mock("../management-panel", () => ({ ChecklistCard: () => null }));
vi.mock("@/components/dashboard/ai-written-badge", () => ({ AiWrittenBadge: () => null }));
vi.mock("@/industries/education-consultancy/features/applicant-documents/documents-card", () => ({ ApplicantDocumentsCard: () => null }));
vi.mock("./log-activity-modal", () => ({ LogActivityModal: () => null }));

import { getSystemActivityDescription } from "./activities-panel";
import type { LeadActivity } from "@/lib/supabase/queries";

const NAMES = { "user-1": "Mamata Sah" };
const EMAILS = { "user-2": "ravi@example.com" };

const move = (extra: LeadActivity["changes"] = {}): LeadActivity => ({
  id: "a1",
  action: "lead.updated",
  entity_type: "lead",
  user_id: "actor",
  created_at: "2026-11-02T10:43:00Z",
  changes: { list: { old: "New Leads", new: "Qualified" }, ...extra },
});

describe("stage-move line shows who the lead is assigned to", () => {
  it("an old row (no assignee saved) is unchanged", () => {
    expect(getSystemActivityDescription(move(), EMAILS, NAMES)).toBe('Moved from "New Leads" to "Qualified"');
  });

  it("a move that also reassigns says 'assigned to <name>'", () => {
    const row = move({ assigned_to: { old: "user-2", new: "user-1" } });
    expect(getSystemActivityDescription(row, EMAILS, NAMES)).toBe('Moved from "New Leads" to "Qualified" · assigned to Mamata Sah');
  });

  it("a move that keeps the assignee says 'with <name>' from the recorded holder", () => {
    const row = move({ holder: { old: null, new: "user-1" } });
    expect(getSystemActivityDescription(row, EMAILS, NAMES)).toBe('Moved from "New Leads" to "Qualified" · with Mamata Sah');
  });

  it("a reassignment wins over the holder", () => {
    const row = move({ assigned_to: { old: "user-2", new: "user-1" }, holder: { old: null, new: "user-2" } });
    expect(getSystemActivityDescription(row, EMAILS, NAMES)).toContain("assigned to Mamata Sah");
  });

  it("falls back to the email when there is no name", () => {
    const row = move({ holder: { old: null, new: "user-2" } });
    expect(getSystemActivityDescription(row, EMAILS, NAMES)).toBe('Moved from "New Leads" to "Qualified" · with ravi@example.com');
  });

  it("an unknown user adds nothing (never invents a name) and doesn't crash", () => {
    const row = move({ holder: { old: null, new: "ghost" } });
    expect(getSystemActivityDescription(row, EMAILS, NAMES)).toBe('Moved from "New Leads" to "Qualified"');
  });

  it("an unassigned lead adds nothing", () => {
    const row = move({ holder: { old: null, new: null } });
    expect(getSystemActivityDescription(row, EMAILS, NAMES)).toBe('Moved from "New Leads" to "Qualified"');
  });

  it("a brand-new lead entering a stage keeps its 'Added to' wording and gets the name too", () => {
    const row: LeadActivity = { ...move({ holder: { old: null, new: "user-1" } }), changes: { list: { old: null, new: "Qualified" }, holder: { old: null, new: "user-1" } } };
    expect(getSystemActivityDescription(row, EMAILS, NAMES)).toBe('Added to "Qualified" · with Mamata Sah');
  });

  it("an archive move is unchanged", () => {
    const row = move({ archive_reason: { old: null, new: "Not interested" }, holder: { old: null, new: "user-1" } });
    expect(getSystemActivityDescription(row, EMAILS, NAMES)).toBe("Archived · Not interested");
  });
});
