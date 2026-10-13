// @vitest-environment jsdom
//
// A document attached to a qualification ("Grade X", "+2", "Bachelor's", "Master's") now keeps that link (migration 240; the server used to
// drop it). The document list shows which level a document belongs to.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ApplicantDocumentsCard } from "./documents-card";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

const doc = (id: string, over: Record<string, unknown> = {}) => ({
  id, document_type: "marksheet", name: `${id}.pdf`, original_filename: `${id}.pdf`, mime_type: "application/pdf", file_size: 2048,
  status: "uploaded", processing_error: null, current_version_id: `v-${id}`, uploaded_by: "u1", created_at: new Date().toISOString(), ...over,
});

function renderWith(documents: ReturnType<typeof doc>[]) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: { documents, by_category: {}, applications: {} } }) }) as Response) as unknown as typeof fetch;
  render(<ApplicantDocumentsCard leadId="lead-1" canManage currentUserId="u1" isAdmin />);
}

describe("Documents card — the qualification a document is linked to", () => {
  it.each([
    ["see", "SEE / Grade X"],
    ["plus_two", "+2 / Grade XI-XII"],
    ["bachelor", "Bachelor's"],
    ["masters", "Master's"],
  ])("shows %s as '%s'", async (level, label) => {
    renderWith([doc("grade", { qualification_level: level })]);
    expect(await screen.findByText(new RegExp(`Marksheet.*${label.replace(/[+/'.]/g, "\\$&")}`))).toBeInTheDocument();
  });

  it("shows nothing extra for a document that is not linked to a level", async () => {
    renderWith([doc("plain", { qualification_level: null })]);
    const meta = await screen.findByText(/Marksheet/);
    expect(meta.textContent).not.toMatch(/Grade|Bachelor|Master/);
  });

  it("ignores a level it does not recognise instead of showing raw text", async () => {
    renderWith([doc("weird", { qualification_level: "phd_2099" })]);
    const meta = await screen.findByText(/Marksheet/);
    expect(meta.textContent).not.toContain("phd_2099");
  });
});
