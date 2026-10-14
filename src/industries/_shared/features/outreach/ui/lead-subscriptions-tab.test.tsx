// @vitest-environment jsdom
//
// The lead page's Subscribed tab: running now (the cadence strip, read with the lead's own visibility), queue next for a busy channel,
// history with plain-words reasons, and the campaigns the lead was sent.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/components/ui/select", async () => await import("./test-select-mock"));
vi.mock("../hooks/use-sequences", () => ({
  useSequences: (channel?: string) => ({
    sequences:
      channel === "sms"
        ? [{ id: "ss-1", name: "Text nudge", status: "active", channel: "sms" }]
        : [
            { id: "s-run", name: "Welcome", status: "active", channel: "email" },
            { id: "s-next", name: "Follow-up", status: "active", channel: "email" },
            { id: "s-arch", name: "Old one", status: "archived", channel: "email" },
          ],
    loading: false,
    refresh: vi.fn(),
  }),
}));
const stripProps = vi.fn();
vi.mock("./lead-cadence-strip", () => ({
  LeadCadenceStrip: (p: Record<string, unknown>) => {
    stripProps(p);
    return <div data-testid="strip" />;
  },
}));

import { LeadSubscriptionsTab } from "./lead-subscriptions-tab";

const LEAD = "3168f9d7-23c7-48c1-a29b-3b9a94b3512f";
const RUNNING = { id: "e-1", sequenceId: "s-run", sequenceName: "Welcome", channel: "email", status: "active", live: true, currentStep: 2, assignedTo: "u1", startedAt: "2026-10-10T00:00:00Z", endedAt: null, stopReason: null };
const PAST = { id: "e-0", sequenceId: "ss-1", sequenceName: "Text nudge", channel: "sms", status: "unenrolled", live: false, currentStep: 1, assignedTo: "u1", startedAt: "2026-09-01T00:00:00Z", endedAt: "2026-09-03T00:00:00Z", stopReason: "replied" };

let data: Record<string, unknown>;
let calls: Array<{ url: string; method: string; body?: unknown }>;
let respond: (url: string, method: string) => { status: number; body: unknown } | null;

beforeEach(() => {
  calls = [];
  respond = () => null;
  data = {
    sequences: [RUNNING, PAST],
    queued: [],
    campaigns: [{ id: "m-1", channel: "email", name: "Autumn intake", status: "delivered", at: "2026-10-05T00:00:00Z" }],
  };
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const custom = respond(u, method);
    if (custom) return { ok: custom.status < 300, status: custom.status, json: async () => custom.body } as Response;
    if (u.endsWith(`/leads/${LEAD}/subscriptions`)) return { ok: true, status: 200, json: async () => ({ data }) } as Response;
    return { ok: false, status: 500, json: async () => ({}) } as Response;
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderTab = () => render(<LeadSubscriptionsTab leadId={LEAD} isAdmin currentUserId="u1" />);

describe("Subscribed tab", () => {
  it("shows Running now (strip read with the lead's visibility), Queue next for the busy channel, History and Campaigns", async () => {
    renderTab();
    await screen.findByText("Autumn intake");

    expect(screen.getByTestId("strip")).toBeInTheDocument();
    expect(stripProps).toHaveBeenCalledWith(expect.objectContaining({ leadId: LEAD, readFromLead: true, labelled: true }));

    // Email is busy -> a Queue next picker, offering only OTHER active email sequences. SMS is free -> no queue row (the strip enrolls).
    const picker = screen.getByRole("combobox", { name: "Queue next Email sequence" }) as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Follow-up"]);
    expect(screen.queryByRole("combobox", { name: "Queue next SMS sequence" })).toBeNull();

    expect(screen.getByText("Text nudge")).toBeInTheDocument();
    expect(screen.getByText("Stopped — the lead replied")).toBeInTheDocument();
    expect(screen.getByText("Delivered")).toBeInTheDocument();
  });

  it("Queue next posts the chosen sequence, then reloads and refreshes the running strip", async () => {
    respond = (u, m) => (u.endsWith("/subscriptions/queue") && m === "POST" ? { status: 201, body: { data: { queued: true, startedNow: false } } } : null);
    renderTab();
    const picker = await screen.findByRole("combobox", { name: "Queue next Email sequence" });
    const stripRendersBefore = stripProps.mock.calls.length;

    fireEvent.change(picker, { target: { value: "s-next" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue next" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Queued — it starts when the current one ends."));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: `/api/v1/leads/${LEAD}/subscriptions/queue`, body: { sequence_id: "s-next" } });
    await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.url.endsWith("/subscriptions")).length).toBe(2));
    expect(stripProps.mock.calls.length).toBeGreaterThan(stripRendersBefore);
  });

  it("shows the server's reason when queueing is refused", async () => {
    respond = (u, m) =>
      u.endsWith("/subscriptions/queue") && m === "POST" ? { status: 409, body: { error: { message: "This lead already has an email sequence waiting." } } } : null;
    renderTab();
    fireEvent.change(await screen.findByRole("combobox", { name: "Queue next Email sequence" }), { target: { value: "s-next" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue next" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("This lead already has an email sequence waiting."));
  });

  it("a waiting sequence is shown with Remove instead of the picker; Remove deletes that queue row", async () => {
    data = { ...data, queued: [{ id: "q-1", sequenceId: "s-next", sequenceName: "Follow-up", channel: "email", queuedAt: "2026-10-11T00:00:00Z" }] };
    respond = (u, m) => (m === "DELETE" ? { status: 200, body: { data: { removed: true } } } : null);
    renderTab();
    await screen.findByText("starts after Welcome");
    expect(screen.queryByRole("combobox", { name: "Queue next Email sequence" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Removed from the queue"));
    expect(calls.find((c) => c.method === "DELETE")?.url).toBe(`/api/v1/leads/${LEAD}/subscriptions/queue?queue_id=q-1`);
  });

  it("plain empty states when there is no history and no campaign", async () => {
    data = { sequences: [], queued: [], campaigns: [] };
    renderTab();
    await screen.findByText("No past sequences yet.");
    expect(screen.getByText("This lead hasn't been sent any campaigns.")).toBeInTheDocument();
    expect(screen.queryByText("Queue next")).toBeNull(); // nothing running -> nothing to queue behind
  });

  it("says so (with Try again) when the list can't load — never an empty-looking tab", async () => {
    respond = (u) => (u.endsWith("/subscriptions") ? { status: 500, body: {} } : null);
    renderTab();
    const box = (await screen.findByText(/Couldn.t load this lead.s subscriptions/)).parentElement!;
    expect(within(box).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No past sequences yet.")).toBeNull();
  });

  it("tags every row Email or SMS, shows counts, marks deleted campaigns, and folds long lists behind Show all", async () => {
    data = {
      ...data,
      campaigns: Array.from({ length: 7 }, (_, i) => ({
        id: `m-${i}`,
        channel: i === 0 ? "sms" : "email",
        name: `Campaign ${i}`,
        campaignDeleted: i === 1,
        status: "delivered",
        at: `2026-10-0${9 - i}T00:00:00Z`,
      })),
    };
    renderTab();
    await screen.findByText("Campaign 0");

    expect(screen.getByRole("heading", { name: "Campaigns (7)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "History (1)" })).toBeInTheDocument();
    // History row "Text nudge" is an SMS sequence; first campaign is SMS, the rest email.
    expect(screen.getByText("Text nudge").closest("li")).toHaveTextContent("SMS");
    expect(screen.getByText("Campaign 0").closest("li")).toHaveTextContent("SMS");
    expect(screen.getByText("Campaign 2").closest("li")).toHaveTextContent("Email");
    expect(screen.getByText("Campaign 1").closest("li")).toHaveTextContent("(campaign deleted)");

    // Only the latest 5 until "Show all".
    expect(screen.queryByText("Campaign 5")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all (7)" }));
    expect(screen.getByText("Campaign 6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.queryByText("Campaign 6")).toBeNull();
  });
});
