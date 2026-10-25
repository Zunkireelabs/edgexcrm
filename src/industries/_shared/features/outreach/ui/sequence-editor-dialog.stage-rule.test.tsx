// @vitest-environment jsdom
//
// SequenceEditorDialog × "Auto-enroll by stage" (migration 277) — the SAVE flow. Pins: the sequence is saved first, then the
// rule through its own endpoint with exactly what the person chose; an untouched card never calls it; ticking the card with no
// stage blocks the save; a stage another sequence holds is sent with replace:true (the on-screen warning was the confirmation);
// a failing rule save is reported but never loses the sequence; unticking an existing rule sends an empty list.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a), message: vi.fn(), info: vi.fn() } }));
vi.mock("@/industries/_shared/features/email/components/tiptap-editor", () => ({ TipTapEditor: () => <div data-testid="tiptap" /> }));
vi.mock("@/industries/_shared/features/email/components/html-source-editor", () => ({ HtmlSourceEditor: () => <div data-testid="html" /> }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">—</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import { SequenceEditorDialog } from "./sequence-editor-dialog";
import type { Sequence } from "../hooks/use-sequences";

const QUALIFIED = "l-qualified";
const PROSPECTS = "l-prospects";

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}
let calls: Call[];
let rules: Array<Record<string, unknown>>;
let ruleResponse: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  rules = [];
  ruleResponse = { status: 200, body: { data: { stages: [], replaced: [], enrolled_existing: null } } };
  toastError.mockReset();
  toastSuccess.mockReset();
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, url: u, body });
    if (u.startsWith("/api/v1/lead-lists"))
      return { ok: true, json: async () => ({ data: [{ id: QUALIFIED, name: "Qualified" }, { id: PROSPECTS, name: "Prospects" }] }) } as Response;
    if (u.startsWith("/api/v1/outreach/stage-triggers"))
      return { ok: true, json: async () => ({ data: { rules, leads_in_stages: u.includes("count_list_ids") ? 40 : null } }) } as Response;
    if (u.includes("/stage-triggers")) return { ok: ruleResponse.status < 400, status: ruleResponse.status, json: async () => ruleResponse.body } as Response;
    if (u.includes("send-window-defaults"))
      return { ok: true, json: async () => ({ data: { timezone: "Asia/Kathmandu", window: { time: "10:00", days: [1, 2, 3, 4, 5], timezone_mode: "lead", spread_minutes: 120 } } }) } as Response;
    if (u.includes("send-capability")) return { ok: true, json: async () => ({ data: { enabled: false } }) } as Response;
    if (u === "/api/v1/outreach/sequences" && method === "POST") return { ok: true, status: 201, json: async () => ({ data: { id: "seq-new", name: "Qualified follow-up" } }) } as Response;
    if (u.startsWith("/api/v1/outreach/sequences/seq-1") && method === "PATCH") return { ok: true, status: 200, json: async () => ({ data: { id: "seq-1", name: "Welcome" } }) } as Response;
    if (u.startsWith("/api/v1/outreach/sequences/seq-1")) return { ok: true, json: async () => ({ data: { locked_up_to: 0, live_enrollments: 0 } }) } as Response;
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as typeof fetch;
});
afterEach(cleanup);

const existing: Sequence = {
  id: "seq-1", name: "Welcome", description: null, status: "active", created_at: "2026-10-01T00:00:00Z", auto_send: false, on_reply: "pause", send_window: null,
  email_sequence_steps: [{ id: "st-1", step_order: 1, delay_days: 0, subject_template: "Hi", body_template: "<p>Hi</p>", draft_source: "template", ai_instructions: null }],
  sequence_stage_triggers: [{ list_id: QUALIFIED, is_active: true, lead_lists: { name: "Qualified", sort_order: 10 } }],
};

function open(sequence: Sequence | null, channel: "email" | "sms" = "email") {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(<SequenceEditorDialog open onOpenChange={onOpenChange} sequence={sequence} onSaved={onSaved} industryId="education_consultancy" channel={channel} />);
  return { onSaved, onOpenChange };
}

const ruleCalls = () => calls.filter((c) => c.url.includes("/stage-triggers") && c.method === "PUT");
const saveButton = () => screen.getByRole("button", { name: /^(Create sequence|Save changes|Save)$/ });
const stagePicker = async () => {
  await screen.findByRole("checkbox", { name: /Auto-enroll by stage/ });
  return screen.getAllByRole("combobox").find((s) => within(s).queryByText("Prospects")) as HTMLSelectElement;
};

describe("creating a sequence with a stage rule", () => {
  it("saves the sequence first, then sends the rule with exactly what was chosen", async () => {
    const { onSaved } = open(null);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Qualified follow-up" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Auto-enroll by stage/ }));
    fireEvent.change(await stagePicker(), { target: { value: QUALIFIED } });
    fireEvent.click(await screen.findByLabelText(/Also enroll the 40 leads/));
    fireEvent.click(saveButton());

    await waitFor(() => expect(ruleCalls()).toHaveLength(1));
    const order = calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`);
    expect(order).toEqual(["POST /api/v1/outreach/sequences", "PUT /api/v1/outreach/sequences/seq-new/stage-triggers"]);
    expect(ruleCalls()[0].body).toEqual({ list_ids: [QUALIFIED], replace: false, enroll_existing: true });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: "seq-new", name: "Qualified follow-up", created: true }));
  });

  it("a card nobody touched never calls the rule endpoint", async () => {
    open(null);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Plain sequence" } });
    await screen.findByRole("checkbox", { name: /Auto-enroll by stage/ });
    fireEvent.click(saveButton());
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/v1/outreach/sequences")).toBe(true));
    expect(ruleCalls()).toHaveLength(0);
  });

  it("ticked with no stage chosen blocks the save — nothing is created", async () => {
    open(null);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "No stage" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Auto-enroll by stage/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Choose at least one stage for auto-enroll, or untick it"));
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a stage another sequence holds is sent with replace:true (the warning on screen was the confirmation)", async () => {
    rules = [{ listId: QUALIFIED, listName: "Qualified", sequenceId: "seq-other", sequenceName: "Qualified nudge", channel: "email" }];
    open(null);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Qualified follow-up" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Auto-enroll by stage/ }));
    fireEvent.change(await stagePicker(), { target: { value: QUALIFIED } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Qualified nudge");
    fireEvent.click(saveButton());
    await waitFor(() => expect(ruleCalls()).toHaveLength(1));
    expect(ruleCalls()[0].body).toMatchObject({ list_ids: [QUALIFIED], replace: true });
  });

  it("if the rule can't be saved, the sequence is still saved and the person is told why", async () => {
    ruleResponse = { status: 403, body: { error: { message: "You need SMS permission to auto-enroll leads in an SMS sequence." } } };
    const { onSaved, onOpenChange } = open(null);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Qualified follow-up" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Auto-enroll by stage/ }));
    fireEvent.change(await stagePicker(), { target: { value: QUALIFIED } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining("The sequence was saved, but auto-enroll wasn't")));
    expect(toastError.mock.calls[0][0]).toContain("You need SMS permission");
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("editing an existing sequence", () => {
  it("shows the stages it already auto-enrolls from, ticked", async () => {
    open(existing);
    expect(await screen.findByRole("checkbox", { name: /Auto-enroll by stage/ })).toBeChecked();
    expect(await screen.findByText("Qualified", { selector: "span" })).toBeInTheDocument();
  });

  it("unticking switches it off — an empty list is sent", async () => {
    open(existing);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Auto-enroll by stage/ }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(ruleCalls()).toHaveLength(1));
    expect(ruleCalls()[0].url).toBe("/api/v1/outreach/sequences/seq-1/stage-triggers");
    expect(ruleCalls()[0].body).toEqual({ list_ids: [], replace: false, enroll_existing: false });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Auto-enroll is off for this sequence"));
  });

  it("editing only the wording never touches the rule", async () => {
    open(existing);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Welcome (new)" } });
    await screen.findByRole("checkbox", { name: /Auto-enroll by stage/ });
    fireEvent.click(saveButton());
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(ruleCalls()).toHaveLength(0);
  });
});

describe("an SMS sequence", () => {
  it("gets the same card, in SMS words", async () => {
    open(null, "sms");
    fireEvent.click(await screen.findByRole("checkbox", { name: /Auto-enroll by stage/ }));
    expect(await screen.findByText(/start this SMS sequence automatically\. If a lead/)).toBeInTheDocument();
  });
});
