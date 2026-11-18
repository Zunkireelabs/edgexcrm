// @vitest-environment jsdom
//
// Client request (Manish, 2026-11-18): the System Activity line for a collaborator being added or removed
// must say who. The audit row stores the user id; the line resolves it to a name (or email), and falls back
// to the old plain wording when the id can't be resolved.
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

const NAMES = { "user-1": "Admizz Admin" };
const EMAILS = { "user-2": "ravi@example.com" };

const row = (action: string, collaborator: { old: unknown; new: unknown } | undefined): LeadActivity => ({
  id: "a1",
  action,
  entity_type: "lead",
  user_id: "actor",
  created_at: "2026-11-18T05:00:00Z",
  changes: collaborator ? { collaborator } : {},
});

describe("collaborator add/remove lines say who", () => {
  it("removed: shows the name of the person removed", () => {
    expect(getSystemActivityDescription(row("lead.collaborator_removed", { old: "user-1", new: null }), EMAILS, NAMES)).toBe("Collaborator removed: Admizz Admin");
  });

  it("added: shows the name of the person added", () => {
    expect(getSystemActivityDescription(row("lead.collaborator_added", { old: null, new: "user-1" }), EMAILS, NAMES)).toBe("Collaborator added: Admizz Admin");
  });

  it("falls back to the email when there is no name", () => {
    expect(getSystemActivityDescription(row("lead.collaborator_removed", { old: "user-2", new: null }), EMAILS, NAMES)).toBe("Collaborator removed: ravi@example.com");
  });

  it("an unknown user id keeps the plain wording", () => {
    expect(getSystemActivityDescription(row("lead.collaborator_removed", { old: "gone", new: null }), EMAILS, NAMES)).toBe("Collaborator removed");
    expect(getSystemActivityDescription(row("lead.collaborator_added", { old: null, new: "gone" }), EMAILS, NAMES)).toBe("Collaborator added");
  });

  it("a row with no collaborator saved keeps the plain wording", () => {
    expect(getSystemActivityDescription(row("lead.collaborator_removed", undefined), EMAILS, NAMES)).toBe("Collaborator removed");
  });
});
