// @vitest-environment jsdom
//
// LeadCadenceStrip — the "next email" line on a lead's page asks for THIS lead's pending draft only. The old unfiltered
// call loaded the whole worklist (capped at 1,000 rows by the server), so on a big tenant a lead beyond the cap showed no
// next email at all. Also shows the plain-words reason when the system stopped the enrollment.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

let smsSequences: Array<Record<string, unknown>> = [];
vi.mock("../hooks/use-sequences", () => ({
  useSequences: (channel?: string) => ({
    sequences: channel === "sms" ? smsSequences : [{ id: "s1", name: "Welcome", email_sequence_steps: [{}, {}, {}] }],
    loading: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("./cadence-timeline", () => ({ CadenceTimeline: () => <div data-testid="timeline" /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LeadCadenceStrip } from "./lead-cadence-strip";

const LEAD = "3168f9d7-23c7-48c1-a29b-3b9a94b3512f";
let urls: string[];
let enrollment: Record<string, unknown>;
let smsEnrollment: Record<string, unknown> | null;

beforeEach(() => {
  urls = [];
  smsSequences = [];
  smsEnrollment = null;
  enrollment = { id: "e1", sequence_id: "s1", status: "active", current_step_order: 1, assigned_to: "u1", email_sequences: { name: "Welcome" } };
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("/outreach/enrollments")) {
      // each channel only ever sees its own enrollment
      const rows = u.includes("channel=sms") ? (smsEnrollment ? [smsEnrollment] : []) : [enrollment];
      return { ok: true, json: async () => ({ data: rows }) } as Response;
    }
    if (u.includes("/outreach/drafts")) return { ok: true, json: async () => ({ data: [{ lead_id: LEAD, due_at: "2026-10-07T04:15:00.000Z" }] }) } as Response;
    return { ok: false, json: async () => ({}) } as Response;
  }) as typeof fetch;
});
afterEach(cleanup);

describe("LeadCadenceStrip", () => {
  it("asks for this lead's drafts only — never the whole worklist", async () => {
    render(<LeadCadenceStrip leadId={LEAD} isAdmin currentUserId="u1" />);
    await waitFor(() => expect(urls.some((u) => u.includes("/outreach/drafts"))).toBe(true));
    expect(urls.find((u) => u.includes("/outreach/drafts"))).toBe(`/api/v1/outreach/drafts?due=all&lead_id=${LEAD}&channel=email`);
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

  it("shows a lead's SMS sequence next to the email one, each asked for by its own channel", async () => {
    smsSequences = [{ id: "ss1", name: "Text follow-up", email_sequence_steps: [{}, {}] }];
    smsEnrollment = { id: "e2", sequence_id: "ss1", status: "active", current_step_order: 1, assigned_to: "u1", email_sequences: { name: "Text follow-up" } };
    render(<LeadCadenceStrip leadId={LEAD} isAdmin currentUserId="u1" />);
    await screen.findByText("In SMS sequence:");
    await screen.findByText("In sequence:");
    expect(urls).toContain(`/api/v1/outreach/enrollments?lead_id=${LEAD}&channel=email`);
    expect(urls).toContain(`/api/v1/outreach/enrollments?lead_id=${LEAD}&channel=sms`);
    expect(urls).toContain(`/api/v1/outreach/drafts?due=all&lead_id=${LEAD}&channel=sms`);
  });

  it("offers an SMS sequence to a lead that is only in an email one", async () => {
    smsSequences = [{ id: "ss1", name: "Text follow-up", email_sequence_steps: [{}] }];
    render(<LeadCadenceStrip leadId={LEAD} isAdmin currentUserId="u1" />);
    await screen.findByText("Not in an SMS sequence");
    await screen.findByText("In sequence:");
  });

  it("says nothing about SMS when the account has no SMS sequences and the lead is in none", async () => {
    render(<LeadCadenceStrip leadId={LEAD} isAdmin currentUserId="u1" />);
    await screen.findByText("In sequence:");
    expect(screen.queryByText(/SMS/)).toBeNull();
  });
});

describe("LeadCadenceStrip — readFromLead (the Subscribed tab)", () => {
  it("reads the lead's own subscriptions, so a sequence worked by a colleague still shows (not 'Not in a sequence')", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      urls.push(u);
      if (u.endsWith(`/leads/${LEAD}/subscriptions`)) {
        return {
          ok: true,
          json: async () => ({
            data: {
              sequences: [
                { id: "e9", sequenceId: "s1", sequenceName: "Welcome", channel: "email", status: "active", live: true, currentStep: 2, assignedTo: "u-colleague", startedAt: "2026-10-01T00:00:00Z", endedAt: null, stopReason: null },
              ],
              queued: [],
              campaigns: [],
            },
          }),
        } as Response;
      }
      if (u.includes("/outreach/drafts")) return { ok: true, json: async () => ({ data: [] }) } as Response;
      return { ok: false, json: async () => ({}) } as Response;
    }) as typeof fetch;
    const onChanged = vi.fn();
    render(<LeadCadenceStrip leadId={LEAD} isAdmin={false} currentUserId="u1" readFromLead onChanged={onChanged} />);
    await screen.findByText("Welcome");
    expect(urls.some((u) => u.includes("/outreach/enrollments"))).toBe(false);
    expect(screen.queryByText(/Not in a sequence/)).toBeNull();
  });

  it("without readFromLead (the Emails tab) it still reads the outreach list exactly as before", async () => {
    render(<LeadCadenceStrip leadId={LEAD} isAdmin currentUserId="u1" />);
    await waitFor(() => expect(urls.some((u) => u.includes(`/outreach/enrollments?lead_id=${LEAD}&channel=email`))).toBe(true));
    expect(urls.some((u) => u.includes("/subscriptions"))).toBe(false);
  });
});

describe("LeadCadenceStrip — labelled (the Subscribed tab)", () => {
  it("shows each channel in its own titled box: 'Email sequence' and 'SMS sequence'", async () => {
    smsSequences = [{ id: "ss1", name: "Text follow-up", email_sequence_steps: [{}] }];
    render(<LeadCadenceStrip leadId={LEAD} isAdmin currentUserId="u1" labelled />);
    const email = await screen.findByRole("region", { name: "Email sequence" });
    const sms = await screen.findByRole("region", { name: "SMS sequence" });
    expect(email).toHaveTextContent("Welcome"); // the running email sequence
    expect(sms).toHaveTextContent("Not running"); // free SMS channel, with its picker
    expect(within(sms).getByRole("button", { name: "Enroll" })).toBeInTheDocument();
  });

  it("hides the SMS box for a tenant with no SMS sequences (no empty box)", async () => {
    render(<LeadCadenceStrip leadId={LEAD} isAdmin currentUserId="u1" labelled />);
    await screen.findByRole("region", { name: "Email sequence" });
    expect(screen.queryByRole("region", { name: "SMS sequence" })).toBeNull();
  });
});
