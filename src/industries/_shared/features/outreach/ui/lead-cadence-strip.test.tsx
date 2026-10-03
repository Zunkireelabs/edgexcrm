// @vitest-environment jsdom
//
// LeadCadenceStrip — the "next email" line on a lead's page asks for THIS lead's pending draft only. The old unfiltered
// call loaded the whole worklist (capped at 1,000 rows by the server), so on a big tenant a lead beyond the cap showed no
// next email at all. Also shows the plain-words reason when the system stopped the enrollment.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

vi.mock("../hooks/use-sequences", () => ({ useSequences: () => ({ sequences: [{ id: "s1", name: "Welcome", email_sequence_steps: [{}, {}, {}] }], loading: false, refresh: vi.fn() }) }));
vi.mock("./cadence-timeline", () => ({ CadenceTimeline: () => <div data-testid="timeline" /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LeadCadenceStrip } from "./lead-cadence-strip";

const LEAD = "3168f9d7-23c7-48c1-a29b-3b9a94b3512f";
let urls: string[];
let enrollment: Record<string, unknown>;

beforeEach(() => {
  urls = [];
  enrollment = { id: "e1", sequence_id: "s1", status: "active", current_step_order: 1, assigned_to: "u1", email_sequences: { name: "Welcome" } };
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("/outreach/enrollments")) return { ok: true, json: async () => ({ data: [enrollment] }) } as Response;
    if (u.includes("/outreach/drafts")) return { ok: true, json: async () => ({ data: [{ lead_id: LEAD, due_at: "2026-10-07T04:15:00.000Z" }] }) } as Response;
    return { ok: false, json: async () => ({}) } as Response;
  }) as typeof fetch;
});
afterEach(cleanup);

describe("LeadCadenceStrip", () => {
  it("asks for this lead's drafts only — never the whole worklist", async () => {
    render(<LeadCadenceStrip leadId={LEAD} isAdmin currentUserId="u1" />);
    await waitFor(() => expect(urls.some((u) => u.includes("/outreach/drafts"))).toBe(true));
    expect(urls.find((u) => u.includes("/outreach/drafts"))).toBe(`/api/v1/outreach/drafts?due=all&lead_id=${LEAD}`);
    await screen.findByText(/next draft/);
  });

  it("does not ask for drafts at all when the enrollment is paused", async () => {
    enrollment = { ...enrollment, status: "paused" };
    render(<LeadCadenceStrip leadId={LEAD} isAdmin currentUserId="u1" />);
    await screen.findByText("paused");
    expect(urls.some((u) => u.includes("/outreach/drafts"))).toBe(false);
  });

  it("explains an enrollment the system paused because the lead replied", async () => {
    enrollment = { ...enrollment, status: "paused", stop_reason: "replied" };
    render(<LeadCadenceStrip leadId={LEAD} isAdmin currentUserId="u1" />);
    await screen.findByText(/the lead replied/);
  });
});
