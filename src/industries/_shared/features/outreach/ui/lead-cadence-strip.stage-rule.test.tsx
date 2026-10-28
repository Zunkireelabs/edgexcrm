// @vitest-environment jsdom
//
// LeadCadenceStrip × stage auto-enroll (migration 277) on the lead's Subscribed tab. Pins: a rule-started enrollment says so
// ("Auto-enrolled · entered Qualified") and a manual one doesn't; Unenroll on a MANUAL enrollment is immediate (unchanged), on a
// rule-started one it asks a single question — "also don't auto-enroll this lead into other stages' sequences" — unticked by
// default, so a plain confirm never switches anything off; ticking it sends the opt-out for THAT channel only after the
// unenroll; a channel that is switched off says so and can be turned back on.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

vi.mock("../hooks/use-sequences", () => ({
  useSequences: () => ({ sequences: [{ id: "s1", name: "Welcome", email_sequence_steps: [{}, {}] }], loading: false, refresh: vi.fn() }),
}));
vi.mock("./cadence-timeline", () => ({ CadenceTimeline: () => <div data-testid="timeline" /> }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { LeadCadenceStrip } from "./lead-cadence-strip";

const LEAD = "3168f9d7-23c7-48c1-a29b-3b9a94b3512f";

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}
let calls: Call[];
let sequences: Array<Record<string, unknown>>;
let optOuts: { email: boolean; sms: boolean };

const row = (over: Record<string, unknown>) => ({
  id: "e1",
  sequenceId: "s1",
  sequenceName: "Qualified follow-up",
  channel: "email",
  status: "active",
  live: true,
  currentStep: 1,
  assignedTo: "u1",
  startedAt: "2026-10-25T00:00:00Z",
  endedAt: null,
  stopReason: null,
  source: "manual",
  triggerStageName: null,
  ...over,
});

beforeEach(() => {
  calls = [];
  toastSuccess.mockReset();
  toastError.mockReset();
  optOuts = { email: false, sms: false };
  sequences = [row({})];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ method, url: u, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    if (u.endsWith("/subscriptions")) return { ok: true, json: async () => ({ data: { sequences, queued: [], campaigns: [], autoEnrollOptOuts: optOuts } }) } as Response;
    if (u.includes("/outreach/drafts")) return { ok: true, json: async () => ({ data: [] }) } as Response;
    if (u.includes("/outreach/enrollments/") && method === "PATCH") return { ok: true, json: async () => ({ data: {} }) } as Response;
    if (u.includes("/auto-enroll-optout")) return { ok: true, json: async () => ({ data: {} }) } as Response;
    return { ok: false, json: async () => ({}) } as Response;
  }) as typeof fetch;
});
afterEach(cleanup);

const mutations = () => calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`);
const renderTab = () => render(<LeadCadenceStrip leadId={LEAD} isAdmin currentUserId="u1" leadFirstName="Puja" readFromLead labelled />);
const emailBox = () => screen.findByLabelText("Email sequence");
const smsBox = () => screen.findByLabelText("SMS sequence");

describe("the Auto-enrolled badge", () => {
  it("says which stage started it", async () => {
    sequences = [row({ source: "stage_rule", triggerStageName: "Qualified" })];
    renderTab();
    expect(await screen.findByText("Auto-enrolled · entered Qualified")).toBeInTheDocument();
  });

  it("is absent on a sequence a person enrolled", async () => {
    renderTab();
    await screen.findByText("In sequence:");
    expect(screen.queryByText(/Auto-enrolled/)).toBeNull();
  });

  it("still reads sensibly when the stage was deleted", async () => {
    sequences = [row({ source: "stage_rule", triggerStageName: null })];
    renderTab();
    expect(await screen.findByText("Auto-enrolled")).toBeInTheDocument();
  });
});

describe("Unenroll", () => {
  it("on a manual enrollment is immediate — no question, no opt-out (unchanged behaviour)", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /Unenroll/ }));
    await waitFor(() => expect(mutations()).toEqual([`PATCH /api/v1/outreach/enrollments/e1`]));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ action: "unenroll" });
  });

  it("on an auto-enrolled one asks first; the opt-out box starts UNTICKED", async () => {
    sequences = [row({ source: "stage_rule", triggerStageName: "Qualified" })];
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /Unenroll/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/It started automatically, so it won.t restart on its own/)).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox")).not.toBeChecked();
    expect(mutations()).toEqual([]); // nothing happens until they confirm
  });

  it("a plain confirm unenrolls and does NOT switch auto-enroll off", async () => {
    sequences = [row({ source: "stage_rule", triggerStageName: "Qualified" })];
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /Unenroll/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Unenroll" }));
    await waitFor(() => expect(mutations()).toEqual([`PATCH /api/v1/outreach/enrollments/e1`]));
  });

  it("ticking the box unenrolls THEN switches auto-enroll off for this channel only", async () => {
    sequences = [row({ source: "stage_rule", triggerStageName: "Qualified" })];
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /Unenroll/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Unenroll" }));
    await waitFor(() => expect(mutations()).toEqual([`PATCH /api/v1/outreach/enrollments/e1`, `PUT /api/v1/leads/${LEAD}/auto-enroll-optout`]));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ channels: ["email"] });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Auto-enroll is off for this lead"));
  });

  it("Cancel does nothing", async () => {
    sequences = [row({ source: "stage_rule", triggerStageName: "Qualified" })];
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /Unenroll/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mutations()).toEqual([]);
  });

  it("an SMS enrollment opts out of SMS, not email", async () => {
    sequences = [row({ id: "e2", channel: "sms", source: "stage_rule", triggerStageName: "Qualified", sequenceName: "Qualified reminder" })];
    renderTab();
    fireEvent.click(await within(await screen.findByLabelText("SMS sequence")).findByRole("button", { name: /Unenroll/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/won.t get any more texts/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Unenroll" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ channels: ["sms"] }));
  });
});

describe("a channel switched off for the lead", () => {
  it("says so, and 'Turn back on' removes the opt-out for that channel", async () => {
    sequences = [];
    optOuts = { email: true, sms: false };
    renderTab();
    const box = await emailBox();
    expect(await within(box).findByText(/Auto-enroll by stage is off for this lead \(email\)/)).toBeInTheDocument();
    fireEvent.click(within(box).getByRole("button", { name: "Turn back on" }));
    await waitFor(() => expect(mutations()).toEqual([`DELETE /api/v1/leads/${LEAD}/auto-enroll-optout`]));
    expect(calls.find((c) => c.method === "DELETE")?.body).toEqual({ channels: ["email"] });
    await waitFor(() => expect(within(box).queryByText(/Auto-enroll by stage is off/)).toBeNull());
  });

  it("only the switched-off channel says it (SMS box stays quiet)", async () => {
    sequences = [row({ id: "e2", channel: "sms", sequenceName: "Qualified reminder" })];
    optOuts = { email: true, sms: false };
    renderTab();
    await within(await emailBox()).findByText(/off for this lead \(email\)/);
    expect(within(await smsBox()).queryByText(/Auto-enroll by stage is off/)).toBeNull();
  });

  it("a lead that is not switched off shows no such line", async () => {
    sequences = [];
    renderTab();
    await within(await emailBox()).findByText("Not running");
    expect(screen.queryByText(/Auto-enroll by stage is off/)).toBeNull();
  });
});
