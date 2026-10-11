// @vitest-environment jsdom
//
// Client request (WhatsApp, Oct 2026): fewer tabs — Calls and Meetings go inside Notes. EDUCATION tenants only: this panel is
// shared by every industry, and the others keep their Calls and Meetings tabs. Pins: for education the sub-tab row has no
// Calls or Meetings; Notes lists typed notes AND logged calls/meetings together (date order), carries the combined count,
// and offers Log Call / Log Meeting / Make a phone call; Emails keeps its own buttons; the unified Activity tab is unchanged;
// for any other industry nothing changed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
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
const documentsCard = vi.fn();
vi.mock("@/industries/education-consultancy/features/applicant-documents/documents-card", () => ({
  ApplicantDocumentsCard: (props: Record<string, unknown>) => {
    documentsCard(props);
    return <div data-testid="documents-card">{String(props.variant ?? "page")}</div>;
  },
}));
const logModal = vi.fn();
vi.mock("./log-activity-modal", () => ({
  LogActivityModal: (props: { open: boolean; activityType: string }) => {
    logModal(props);
    return props.open ? <div data-testid="log-modal">{props.activityType}</div> : null;
  },
}));

import { ActivitiesPanel } from "./activities-panel";
import type { LeadNote } from "@/types/database";

const note = (id: string, content: string, created_at: string) =>
  ({ id, lead_id: "l1", user_id: "u1", user_email: "rep@x.com", content, created_at, updated_at: created_at }) as unknown as LeadNote;

const activity = (id: string, type: "call" | "meeting" | "email", subject: string, created_at: string) => ({
  id, lead_id: "l1", user_id: "u1", activity_type: type, subject, description: null, call_outcome: type === "call" ? "connected" : null, duration_minutes: null,
  email_subject: null, email_body: null, completed_at: created_at, created_at, metadata: null,
});

let activities: ReturnType<typeof activity>[];

beforeEach(() => {
  logModal.mockClear();
  documentsCard.mockClear();
  activities = [
    activity("a1", "call", "Intro call", "2026-10-06T10:00:00Z"),
    activity("a2", "meeting", "Counselling meeting", "2026-10-10T10:00:00Z"),
    activity("a3", "email", "Sent brochure", "2026-10-05T10:00:00Z"),
  ];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.endsWith("/activities")) return { ok: true, json: async () => ({ data: activities }) } as Response;
    return { ok: true, json: async () => ({ data: [] }) } as Response;
  }) as typeof fetch;
});
afterEach(cleanup);

function renderPanel(over: Partial<React.ComponentProps<typeof ActivitiesPanel>> = {}) {
  return render(
    <ActivitiesPanel
      leadId="l1"
      notes={[note("n2", "Second note", "2026-10-09T10:00:00Z"), note("n1", "First note", "2026-10-03T10:00:00Z")]}
      systemActivities={[]}
      teamMemberEmails={{}}
      teamMemberNames={{}}
      isAdmin
      canEdit
      canManageNotes
      onNotesChange={() => {}}
      checklists={[]}
      onChecklistsChange={() => {}}
      currentUserId="u1"
      industryId="education_consultancy"
      leadEmail="sita@x.com"
      leadFirstName="Sita"
      leadLastName="Rai"
      threads={[]}
      setThreads={() => {}}
      threadsLoading={false}
      {...over}
    />
  );
}

const tabNames = () => within(document.querySelector(".border-b")!).getAllByRole("button").map((b) => b.textContent?.replace(/\d+$/, "").trim());
const openNotes = async () => {
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: /^Notes/ }));
  await screen.findByText("Second note");
};

describe("Activity panel tabs", () => {
  it("has Activity, Notes, Emails, Tasks and Documents — no Calls and no Meetings tab any more", async () => {
    renderPanel();
    await screen.findByRole("button", { name: /^Notes/ });
    expect(tabNames()).toEqual(["Activity", "Notes", "Emails", "Tasks", "Documents"]);
    expect(screen.queryByRole("button", { name: "Calls" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Meetings" })).toBeNull();
  });

  it("the Notes count adds the logged calls and meetings to the typed notes (2 notes + 1 call + 1 meeting = 4)", async () => {
    renderPanel();
    await waitFor(() => expect(within(screen.getByRole("button", { name: /^Notes/ })).getByText("4")).toBeInTheDocument());
  });
});

describe("Notes tab", () => {
  it("lists notes, calls and meetings together, newest first; emails are not mixed in", async () => {
    await openNotes();
    const text = document.body.textContent ?? "";
    const order = ["Counselling meeting", "Second note", "Call · Connected", "First note"].map((t) => text.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).not.toContain("Sent brochure");
  });

  it("offers Log Call, Make a phone call and Log Meeting, and each opens the right log form", async () => {
    await openNotes();
    expect(screen.getByRole("link", { name: "Make a phone call" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Log Call" }));
    expect((await screen.findByTestId("log-modal")).textContent).toBe("call");
    cleanup();
    await openNotes();
    fireEvent.click(screen.getByRole("button", { name: "Log Meeting" }));
    expect((await screen.findByTestId("log-modal")).textContent).toBe("meeting");
  });

  it("with no notes but a logged call, the call shows and the lead is not told there are no notes", async () => {
    activities = [activity("a1", "call", "Intro call", "2026-10-06T10:00:00Z")];
    renderPanel({ notes: [] });
    fireEvent.click(await screen.findByRole("button", { name: /^Notes/ }));
    await screen.findByText("Call · Connected");
    expect(screen.queryByText("No notes yet")).toBeNull();
  });
});

describe("other tabs are unchanged", () => {
  it("Emails keeps its own buttons and never shows Log Call / Log Meeting", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Emails" }));
    expect(await screen.findByRole("button", { name: "Log past email" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Log Call" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Log Meeting" })).toBeNull();
  });

  it("the Activity tab still shows the calls and meetings in its unified timeline", async () => {
    renderPanel();
    await screen.findByText("Meeting · Counselling meeting");
    expect(screen.getByText("Call · connected")).toBeInTheDocument();
  });
});

describe("other industries keep exactly what they have today", () => {
  const itAgency = { industryId: "it_agency" } as const;

  it("still have Activity, Notes, Emails, Calls, Tasks and Meetings tabs — and no Documents tab", async () => {
    renderPanel(itAgency);
    await screen.findByRole("button", { name: /^Notes/ });
    expect(tabNames()).toEqual(["Activity", "Notes", "Emails", "Calls", "Tasks", "Meetings"]);
  });

  it("the Notes tab has typed notes only, no Log Call / Log Meeting buttons, and the count is just the notes", async () => {
    renderPanel(itAgency);
    fireEvent.click(await screen.findByRole("button", { name: /^Notes/ }));
    await screen.findByText("Second note");
    expect(screen.queryByRole("button", { name: "Log Call" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Log Meeting" })).toBeNull();
    expect(document.body.textContent).not.toContain("Counselling meeting");
    expect(within(screen.getByRole("button", { name: /^Notes/ })).getByText("2")).toBeInTheDocument();
  });

  it("the Calls tab still lists the calls with its own Log Call button, and Meetings likewise", async () => {
    renderPanel(itAgency);
    fireEvent.click(await screen.findByRole("button", { name: "Calls" }));
    expect(await screen.findByRole("button", { name: "Log Call" })).toBeInTheDocument();
    expect(await screen.findByText("Call · Connected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Meetings" }));
    expect(await screen.findByRole("button", { name: "Log Meeting" })).toBeInTheDocument();
    expect(await screen.findByText("Counselling meeting")).toBeInTheDocument();
  });
});

describe("Documents sub-tab (last in the row, where the client pointed)", () => {
  it("opens the full documents card for this lead, with the same edit rights as the right-column card", async () => {
    renderPanel({ canEdit: true, isAdmin: false });
    fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
    expect(await screen.findByTestId("documents-card")).toHaveTextContent("page");
    expect(documentsCard).toHaveBeenCalledWith(expect.objectContaining({ leadId: "l1", canManage: true, currentUserId: "u1", isAdmin: false }));
    expect(documentsCard.mock.calls[0][0].variant).toBeUndefined(); // the full card, not the summary
  });

  it("an explicit 'cannot edit' wins over being an admin; with no answer admins can manage", async () => {
    renderPanel({ canEdit: false, isAdmin: true });
    fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
    await screen.findByTestId("documents-card");
    expect(documentsCard.mock.calls.at(-1)![0].canManage).toBe(false);
    cleanup();
    documentsCard.mockClear();
    renderPanel({ canEdit: undefined, isAdmin: true });
    fireEvent.click(await screen.findByRole("button", { name: "Documents" }));
    await screen.findByTestId("documents-card");
    expect(documentsCard.mock.calls.at(-1)![0].canManage).toBe(true);
  });

  it("the card is not loaded until the tab is opened", async () => {
    renderPanel();
    await screen.findByRole("button", { name: "Documents" });
    expect(screen.queryByTestId("documents-card")).toBeNull();
  });

  it("a tenant without the documents feature has no Documents tab", async () => {
    renderPanel({ industryId: "it_agency" });
    await screen.findByRole("button", { name: /^Notes/ });
    expect(screen.queryByRole("button", { name: "Documents" })).toBeNull();
  });

  it("openDocuments() (used by the right-column card's View all) switches to the tab", async () => {
    const ref = React.createRef<import("./activities-panel").ActivitiesPanelRef>();
    renderPanel({ ref } as never);
    await screen.findByRole("button", { name: "Documents" });
    React.act(() => ref.current!.openDocuments());
    expect(await screen.findByTestId("documents-card")).toBeInTheDocument();
  });
});

