// @vitest-environment jsdom
//
// Education lead detail (EDGEX-153): the Emails tab renders the panel with forcedTab="emails". An empty tab shows ONLY
// its empty-state button (no second Compose in a header row); the outreach strip ("No sequences yet…") lives in the
// "Sequences & campaigns" section at the bottom, not above the empty state.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/industries/_shared/features/email/hooks/use-connected-inboxes", () => ({ useConnectedInboxes: () => ({ inboxes: [] }) }));
vi.mock("@/industries/_shared/features/outreach/ui/lead-cadence-strip", () => ({ LeadCadenceStrip: () => <div data-testid="strip">No sequences yet — create one in Outreach › Sequences.</div> }));
vi.mock("@/industries/_shared/features/outreach/ui/lead-subscriptions-tab", () => ({
  LeadSubscriptionsTab: ({ plainHeaders }: { plainHeaders?: boolean }) => <div data-testid="subs" data-plain={String(!!plainHeaders)}>Running now</div>,
}));
vi.mock("@/components/dashboard/tasks/task-list", () => ({ TaskList: () => null }));
vi.mock("../management-panel", () => ({ ChecklistCard: () => null }));
vi.mock("@/components/dashboard/ai-written-badge", () => ({ AiWrittenBadge: () => null }));
vi.mock("@/industries/education-consultancy/features/applicant-documents/documents-card", () => ({ ApplicantDocumentsCard: () => null }));
vi.mock("./log-activity-modal", () => ({ LogActivityModal: () => null }));

import { ActivitiesPanel } from "./activities-panel";

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const base = {
  leadId: "L1", notes: [], systemActivities: [], teamMemberEmails: {}, teamMemberNames: {}, isAdmin: true, onNotesChange: () => {},
  checklists: [], onChecklistsChange: () => {}, currentUserId: "u1", industryId: "education_consultancy", leadEmail: "a@b.c",
  threads: [], setThreads: () => {}, threadsLoading: false,
};

describe("ActivitiesPanel forcedTab=emails", () => {
  it("empty: exactly one compose button (the empty state's), the strip sits under 'Sequences & campaigns', header is sentence case", async () => {
    render(
      <ActivitiesPanel
        {...base} forcedTab="emails"
        emailsEmpty={({ compose }) => <button type="button" onClick={compose}>Compose email</button>}
      />,
    );
    await waitFor(() => expect(screen.getByText("Compose email")).toBeTruthy());
    expect(screen.queryAllByRole("button", { name: /compose/i })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /log past email/i })).toBeNull();
    // the old strip is not above the content any more: only the subscriptions section (bottom) renders outreach
    expect(screen.queryByTestId("strip")).toBeNull();
    const heading = screen.getByText("Sequences & campaigns");
    expect(heading.tagName).toBe("H3");
    expect(heading.className).not.toContain("uppercase");
    expect(screen.getByTestId("subs").getAttribute("data-plain")).toBe("true");
    // Sequences section comes after the empty state in the DOM
    const all = screen.getByText("Compose email").compareDocumentPosition(heading);
    expect(all & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
