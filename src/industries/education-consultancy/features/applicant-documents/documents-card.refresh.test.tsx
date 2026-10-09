// @vitest-environment jsdom
//
// After files are attached from the Student Details pop-up (which sits in front of this card), the card must show
// them without a page reload — but only for the same student.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ApplicantDocumentsCard } from "./documents-card";
import { notifyDocumentsChanged } from "./documents-events";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const base = { mime_type: "application/pdf", file_size: 1000, status: "ready", processing_error: null, current_version_id: "v1", uploaded_by: "u1", created_at: new Date().toISOString(), original_filename: "f.pdf", application_id: null };
let docs: Record<string, unknown>[];
let listCalls: number;
const originalFetch = global.fetch;

beforeEach(() => {
  docs = [{ ...base, id: "d1", document_type: "passport", name: "My passport" }];
  listCalls = 0;
  global.fetch = vi.fn(async () => {
    listCalls++;
    return { ok: true, json: async () => ({ data: { documents: docs, by_category: {}, applications: {} } }) } as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

const renderCard = (leadId = "lead-1") => render(<ApplicantDocumentsCard leadId={leadId} canManage currentUserId="u1" isAdmin variant="summary" />);

describe("Documents card refresh", () => {
  it("shows newly attached documents when told, with no page reload", async () => {
    renderCard();
    await screen.findByText("My passport");
    expect(listCalls).toBe(1);
    docs = [{ ...base, id: "d2", document_type: "marksheet", name: "Marksheet", created_at: new Date(Date.now() + 1000).toISOString() }, ...docs];
    act(() => notifyDocumentsChanged("lead-1"));
    expect(await screen.findByText("Marksheet")).toBeInTheDocument();
    expect(listCalls).toBe(2);
  });

  it("ignores another student's documents changing", async () => {
    renderCard();
    await screen.findByText("My passport");
    act(() => notifyDocumentsChanged("lead-2"));
    await new Promise((r) => setTimeout(r, 30));
    expect(listCalls).toBe(1);
  });

  it("stops listening once removed from the page", async () => {
    const { unmount } = renderCard();
    await screen.findByText("My passport");
    unmount();
    notifyDocumentsChanged("lead-1");
    await waitFor(() => expect(listCalls).toBe(1));
  });
});
