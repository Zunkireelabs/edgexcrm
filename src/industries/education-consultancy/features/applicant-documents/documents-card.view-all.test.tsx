// @vitest-environment jsdom
//
// The small Documents card in the lead page's right column: its "View all" can now switch to the lead page's Documents tab
// (onViewAll) instead of leaving for the separate documents page. Without onViewAll it is the same link as before.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ApplicantDocumentsCard } from "./documents-card";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const doc = (n: number) => ({
  id: `d${n}`, document_type: "marksheet", name: `file${n}.pdf`, original_filename: `file${n}.pdf`, mime_type: "application/pdf", file_size: 100,
  status: "uploaded", processing_error: null, current_version_id: `v${n}`, uploaded_by: "u1", created_at: new Date(2026, 9, n).toISOString(),
});

function stubFetch(count: number) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: { documents: Array.from({ length: count }, (_, i) => doc(i + 1)), by_category: {} } }) }) as Response) as unknown as typeof fetch;
}
afterEach(() => cleanup());

const card = (onViewAll?: () => void) =>
  render(<ApplicantDocumentsCard leadId="lead-1" canManage currentUserId="u1" isAdmin={false} variant="summary" onViewAll={onViewAll} />);

describe("summary card — View all", () => {
  it("with onViewAll it is a button that calls it (no page change)", async () => {
    stubFetch(5);
    const onViewAll = vi.fn();
    card(onViewAll);
    fireEvent.click(await screen.findByRole("button", { name: "View all 5 documents →" }));
    expect(onViewAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: /View all/ })).toBeNull();
  });

  it("without onViewAll it is the same link to the documents page as before", async () => {
    stubFetch(5);
    card();
    const link = await screen.findByRole("link", { name: "View all 5 documents →" });
    expect(link).toHaveAttribute("href", "/leads/lead-1/documents");
  });

  it("with few documents the wording says 'all documents' and still works", async () => {
    stubFetch(2);
    const onViewAll = vi.fn();
    card(onViewAll);
    fireEvent.click(await screen.findByRole("button", { name: "Open all documents →" }));
    await waitFor(() => expect(onViewAll).toHaveBeenCalled());
  });
});
