// @vitest-environment jsdom
//
// Client request (Manish, 2026-11-03): in the lead's Activity, show the files attached inside a university
// application, and show the real course name (the line used to print the UNIVERSITY labelled "Course:").
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
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
vi.mock("@/industries/education-consultancy/features/applicant-documents/documents-card", () => ({ ApplicantDocumentsCard: () => null }));
vi.mock("./log-activity-modal", () => ({ LogActivityModal: () => null }));

import { ActivitiesPanel } from "./activities-panel";

const doc = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id, document_type: "offer_letter", original_filename: `${id}.pdf`,
  application_id: "app-1", application_note_id: null, uploaded_by: "u1", created_at: "2026-11-03T10:30:00Z", ...over,
});

let apps: Record<string, unknown>[];

beforeEach(() => {
  apps = [
    {
      id: "app-1", notes: null, created_at: "2026-10-01T00:00:00Z", updated_at: null, created_by: "u1",
      notes_updated_by: null, notes_updated_at: null,
      university_name: "University of East London", program_name: "BA Hons Hospitality",
      application_notes: [],
      application_documents: [],
    },
  ];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.endsWith("/applications")) return { ok: true, json: async () => ({ data: apps }) } as Response;
    return { ok: true, json: async () => ({ data: [] }) } as Response;
  }) as typeof fetch;
});
afterEach(cleanup);

function renderPanel() {
  return render(
    <ActivitiesPanel
      leadId="l1" notes={[]} systemActivities={[]} teamMemberEmails={{}} teamMemberNames={{ u1: "Mamata Sah" }}
      isAdmin canEdit canManageNotes onNotesChange={() => {}} checklists={[]} onChecklistsChange={() => {}}
      currentUserId="someone-else" industryId="education_consultancy" leadEmail="sita@x.com" leadFirstName="Sita" leadLastName="Rai"
      threads={[]} setThreads={() => {}} threadsLoading={false}
    />,
  );
}

describe("Activity feed — application notes and files", () => {
  it("shows University · Course (not the university labelled 'Course:') on an application note", async () => {
    apps[0].application_notes = [{ id: "n1", application_id: "app-1", content: "Offer received", user_id: "u1", created_at: "2026-11-03T10:00:00Z", documents: [] }];
    renderPanel();
    expect(await screen.findByText("Offer received")).toBeInTheDocument();
    const title = screen.getByText(/^Note added/);
    expect(title.textContent).toBe("Note added · University of East London · BA Hons Hospitality");
    expect(title.textContent).not.toMatch(/Course:/);
    expect(screen.getByRole("link", { name: "University of East London" })).toHaveAttribute("href", "/applications/app-1");
  });

  it("lists the attached files under a note that also has typed text", async () => {
    apps[0].application_notes = [{
      id: "n1", application_id: "app-1", content: "Offer received", user_id: "u1", created_at: "2026-11-03T10:00:00Z",
      documents: [doc("UEL-4212305", { application_note_id: "n1" }), doc("CAS-letter", { application_note_id: "n1", document_type: "visa_document" })],
    }];
    renderPanel();
    await screen.findByText("Offer received");
    const files = await screen.findByTestId("app-feed-files");
    expect(files.textContent).toContain("UEL-4212305 · Offer Letter");
    expect(files.textContent).toContain("CAS-letter");
  });

  it("doesn't print the file twice when the note is only the auto 'Attached: …' text", async () => {
    apps[0].application_notes = [{
      id: "n1", application_id: "app-1", content: "Attached: UEL-4212305", user_id: "u1", created_at: "2026-11-03T10:00:00Z",
      documents: [doc("UEL-4212305", { application_note_id: "n1" })],
    }];
    renderPanel();
    const files = await screen.findByTestId("app-feed-files");
    expect(files.textContent).toContain("UEL-4212305 · Offer Letter");
    expect(screen.queryByText("Attached: UEL-4212305")).toBeNull();
  });

  it("keeps a typed note that merely starts with 'Attached:' only when it has more than the file list", async () => {
    apps[0].application_notes = [{
      id: "n1", application_id: "app-1", content: "Attached: the offer\nplease chase the deposit", user_id: "u1", created_at: "2026-11-03T10:00:00Z",
      documents: [doc("offer", { application_note_id: "n1" })],
    }];
    renderPanel();
    expect(await screen.findByText(/please chase the deposit/)).toBeInTheDocument();
  });

  it("shows a file added straight to the application as its own 'Document added' entry", async () => {
    apps[0].application_documents = [doc("Offer-UEL")];
    renderPanel();
    const title = await screen.findByText(/^Document added/);
    expect(title.textContent).toBe("Document added · University of East London · BA Hons Hospitality");
    expect(screen.getByText("Offer-UEL · Offer Letter")).toBeInTheDocument();
    await waitFor(() => expect(document.body.textContent).toContain("Mamata Sah"));
  });

  it("leaves out the course cleanly when the application has none", async () => {
    apps[0].program_name = null;
    apps[0].application_notes = [{ id: "n1", application_id: "app-1", content: "Hello", user_id: "u1", created_at: "2026-11-03T10:00:00Z", documents: [] }];
    renderPanel();
    await screen.findByText("Hello");
    expect(screen.getByText(/^Note added/).textContent).toBe("Note added · University of East London");
  });
});
