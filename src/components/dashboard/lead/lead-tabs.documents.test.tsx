// @vitest-environment jsdom
//
// Documents lives in the Activity sub-tab row (last tab), where the client pointed — NOT in the top row. LeadTabs only has to
// (a) keep the top row as it was and (b) let the page's right-column documents card open Activity -> Documents.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import React from "react";

const openDocuments = vi.fn();
vi.mock("./activities/activities-panel", () => ({
  ActivitiesPanel: React.forwardRef(function Stub(_props: unknown, ref: React.Ref<unknown>) {
    React.useImperativeHandle(ref, () => ({ openNotes: vi.fn(), openTasks: vi.fn(), openDocuments }));
    return <div data-testid="activities" />;
  }),
}));
vi.mock("./ai-insights-tab", () => ({ AIInsightsTab: () => <div data-testid="ai" /> }));
vi.mock("./professional-details-card", () => ({ ProfessionalDetailsCard: () => null }));
vi.mock("./merge-dialog", () => ({ MergeDialog: () => null }));
vi.mock("@/industries/_shared/features/email/hooks/use-email-threads", () => ({
  useEmailThreads: () => ({ threads: [], setThreads: () => {}, loading: false }),
}));
vi.mock("@/industries/travel-agency/features/itinerary/builder", () => ({ ItineraryBuilder: () => null }));
vi.mock("@/industries/education-consultancy/features/student-record/components/personal-details-dialog", () => ({ PersonalDetailsDialog: () => null }));
vi.mock("@/industries/education-consultancy/features/student-record/components/student-details-summary-card", () => ({ StudentDetailsSummaryCard: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LeadTabs, type LeadTabsRef } from "./lead-tabs";
import type { Lead } from "@/types/database";

const lead = { id: "lead-1", first_name: "Sita", last_name: "Rai", email: "s@x.com", custom_fields: {} } as unknown as Lead;
const onTabChange = vi.fn();

function renderTabs(ref?: React.Ref<LeadTabsRef>) {
  return render(
    <LeadTabs
      ref={ref}
      lead={lead}
      notes={[]}
      activities={[]}
      teamMemberEmails={{}}
      teamMemberNames={{}}
      customFields={{}}
      activeTab="activity"
      onTabChange={onTabChange}
      onNotesChange={() => {}}
      onCustomFieldsChange={() => {}}
      checklists={[]}
      onChecklistsChange={() => {}}
      isAdmin={false}
      canEdit
      currentUserId="u1"
      industryId="education_consultancy"
    />
  );
}

beforeEach(() => {
  openDocuments.mockClear();
  onTabChange.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("LeadTabs and Documents", () => {
  it("the top row is unchanged: Overview, Activity, AI Insights (Documents is NOT here)", () => {
    renderTabs();
    const names = screen.getAllByRole("tab").map((t) => t.textContent?.replace(/\d+$/, "").replace(/Beta$/, "").trim());
    expect(names).toEqual(["Overview", "Activity", "AI Insights"]);
  });

  it("openDocuments() goes to Activity and then opens the Documents sub-tab", () => {
    const ref = React.createRef<LeadTabsRef>();
    renderTabs(ref);
    act(() => ref.current!.openDocuments());
    expect(onTabChange).toHaveBeenCalledWith("activity");
    expect(openDocuments).not.toHaveBeenCalled(); // waits for the Activity tab to mount first
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(openDocuments).toHaveBeenCalledTimes(1);
  });
});
