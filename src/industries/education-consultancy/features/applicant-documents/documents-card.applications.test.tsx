// @vitest-environment jsdom
//
// Client request: in the Documents section, each university application's files are listed under that
// application's name (e.g. "Arden University – MSc Project Management"); everything else stays in the usual groups.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ApplicantDocumentsCard } from "./documents-card";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const base = {
  mime_type: "application/pdf", file_size: 1000, status: "ready", processing_error: null, current_version_id: "v1",
  uploaded_by: "u1", created_at: new Date().toISOString(), original_filename: "f.pdf",
};
const DOCS = [
  { ...base, id: "d1", document_type: "conditional_offer", name: "Arden conditional offer", application_id: "app-1" },
  { ...base, id: "d2", document_type: "unconditional_offer", name: "Arden unconditional offer", application_id: "app-1" },
  { ...base, id: "d3", document_type: "offer_letter", name: "York offer", application_id: "app-2" },
  { ...base, id: "d4", document_type: "passport", name: "My passport", application_id: null },
];
const APPS = {
  "app-1": { university_name: "Arden University", program_name: "MSc Project Management" },
  "app-2": { university_name: "York St John University", program_name: "MBA" },
};

const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: { documents: DOCS, by_category: {}, applications: APPS } }) }) as Response) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

const renderCard = () => render(<ApplicantDocumentsCard leadId="lead-1" canManage currentUserId="u1" isAdmin variant="page" />);

describe("Documents grouped by application", () => {
  it("lists each application's files under that application's name", async () => {
    renderCard();
    const arden = await screen.findByText("Arden University – MSc Project Management");
    const group = arden.closest("[data-document-group]") as HTMLElement;
    expect(group).toHaveAttribute("data-document-group", "app:app-1");
    expect(within(group).getByText("Arden conditional offer")).toBeInTheDocument();
    expect(within(group).getByText("Arden unconditional offer")).toBeInTheDocument();
    expect(within(group).queryByText("York offer")).toBeNull();
    expect(within(group).queryByText("My passport")).toBeNull();
  });

  it("shows a second application as its own group", async () => {
    renderCard();
    const york = (await screen.findByText("York St John University – MBA")).closest("[data-document-group]") as HTMLElement;
    expect(within(york).getByText("York offer")).toBeInTheDocument();
  });

  it("keeps documents that are not tied to an application in the usual category groups, after the applications", async () => {
    renderCard();
    await screen.findByText("Arden University – MSc Project Management");
    const keys = Array.from(document.querySelectorAll("[data-document-group]")).map((n) => n.getAttribute("data-document-group"));
    expect(keys).toEqual(["app:app-1", "app:app-2", "cat:identity"]);
    const identity = document.querySelector('[data-document-group="cat:identity"]') as HTMLElement;
    expect(within(identity).getByText("My passport")).toBeInTheDocument();
  });

  it("falls back to the category when the application's name could not be loaded", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: { documents: DOCS, by_category: {} } }) }) as Response) as unknown as typeof fetch;
    renderCard();
    await screen.findByText("Arden conditional offer");
    expect(screen.queryByText(/Arden University/)).toBeNull();
    const application = document.querySelector('[data-document-group="cat:application"]') as HTMLElement;
    expect(within(application).getByText("Arden conditional offer")).toBeInTheDocument();
  });
});

describe("the small Documents card on the lead page", () => {
  const renderSummary = () => render(<ApplicantDocumentsCard leadId="lead-1" canManage currentUserId="u1" isAdmin variant="summary" />);

  it("shows the latest files with application files under their application's name", async () => {
    // newest first: the card shows the latest three
    const docs = [
      { ...DOCS[0], created_at: "2026-10-09T00:00:00Z" }, // Arden conditional
      { ...DOCS[3], created_at: "2026-10-08T00:00:00Z" }, // passport
      { ...DOCS[2], created_at: "2026-10-07T00:00:00Z" }, // York offer
      { ...DOCS[1], created_at: "2026-10-01T00:00:00Z" }, // older Arden — cut by the limit of 3
    ];
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: { documents: docs, by_category: {}, applications: APPS } }) }) as Response) as unknown as typeof fetch;
    renderSummary();
    const arden = (await screen.findByText("Arden University – MSc Project Management")).closest("[data-document-group]") as HTMLElement;
    expect(within(arden).getByText("Arden conditional offer")).toBeInTheDocument();
    const york = screen.getByText("York St John University – MBA").closest("[data-document-group]") as HTMLElement;
    expect(within(york).getByText("York offer")).toBeInTheDocument();
    // the non-application file is NOT inside an application group; it sits under "Other documents"
    const other = screen.getByText("Other documents").closest("[data-document-group]") as HTMLElement;
    expect(within(other).getByText("My passport")).toBeInTheDocument();
    expect(screen.queryByText("Arden unconditional offer")).toBeNull();
  });

  it("shows no group headings at all when no file is tied to an application", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: { documents: [DOCS[3]], by_category: {}, applications: APPS } }) }) as Response) as unknown as typeof fetch;
    renderSummary();
    await screen.findByText("My passport");
    expect(screen.queryByText("Other documents")).toBeNull();
    expect(screen.queryByText(/University/)).toBeNull();
  });
});
