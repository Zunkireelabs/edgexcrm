// @vitest-environment jsdom
//
// SmsDraftReviewPanel — the plain-text review dialog for a text step: edit the message, Send now, Schedule send, Skip.
// Pins that unsaved edits are saved BEFORE sending / scheduling (the routes read the saved draft), that an empty message
// can't be sent, that a failed send keeps the dialog open with the server's reason, and that success hands control back.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/industries/_shared/features/sms/ui/character-counter", () => ({ CharacterCounter: ({ body }: { body: string }) => <span data-testid="counter">{body.length}</span> }));
// the real picker is covered in its own test: a plain input here
vi.mock("./time-of-day-picker", () => ({
  DateTimePicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Send at" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { SmsDraftReviewPanel } from "./sms-draft-review-panel";

const draft = {
  id: "d1", lead_id: "l1", step_order: 2, due_at: "2026-10-11T04:00:00.000Z", subject: "", body_html: "Hi Sita, checking in",
  status: "pending" as const, draft_source: "template" as const, channel: "sms" as const,
  leads: { first_name: "Sita", last_name: "Rai", email: null, phone: "9801234567" },
  sequence_enrollments: { sequence_id: "s1", status: "active", email_sequences: { name: "Text follow-up" } },
};

interface Call { url: string; method: string; body: Record<string, unknown> | null }
let calls: Call[];
let responses: Record<string, { ok: boolean; json: unknown }>;

const handlers = { onOpenChange: vi.fn(), onSent: vi.fn(), onSkipped: vi.fn(), onUpdated: vi.fn() };
const open = (d: typeof draft | null = draft) => render(<SmsDraftReviewPanel draft={d} {...handlers} />);

beforeEach(() => {
  calls = [];
  responses = {};
  Object.values(handlers).forEach((h) => h.mockClear());
  toastError.mockClear();
  toastSuccess.mockClear();
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    const key = Object.keys(responses).find((k) => u.endsWith(k));
    const r = key ? responses[key] : { ok: true, json: { data: {} } };
    return { ok: r.ok, json: async () => r.json } as Response;
  }) as typeof fetch;
});
afterEach(cleanup);

describe("SmsDraftReviewPanel", () => {
  it("shows the lead, the sequence and the message, in a plain text box with no subject", () => {
    open();
    expect(screen.getByText("Sita Rai")).toBeInTheDocument();
    expect(screen.getByText(/Text follow-up/)).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("Hi Sita, checking in");
    expect(screen.queryByLabelText(/subject/i)).toBeNull();
  });

  it("renders nothing without a draft", () => {
    const { container } = open(null);
    expect(container.textContent).toBe("");
  });

  it("Send now posts the draft's send route and hands control back on success", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Send now/ }));
    await waitFor(() => expect(handlers.onSent).toHaveBeenCalledWith("d1"));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/v1/outreach/drafts/d1/send"]); // nothing edited: no save first
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("saves an edited message BEFORE sending it (the send route reads the saved draft)", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "A different message" } });
    fireEvent.click(screen.getByRole("button", { name: /Send now/ }));
    await waitFor(() => expect(handlers.onSent).toHaveBeenCalled());
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["PATCH /api/v1/outreach/drafts/d1", "POST /api/v1/outreach/drafts/d1/send"]);
    expect(calls[0].body).toEqual({ body_html: "A different message" });
  });

  it("if saving the edit fails, nothing is sent", async () => {
    responses["/drafts/d1"] = { ok: false, json: { error: { message: "Couldn't save" } } };
    open();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Send now/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't save"));
    expect(calls.some((c) => c.url.endsWith("/send"))).toBe(false);
    expect(handlers.onSent).not.toHaveBeenCalled();
  });

  it("a failed send keeps the dialog open and shows the server's reason (e.g. not enough credits)", async () => {
    responses["/send"] = { ok: false, json: { error: { message: "Not enough SMS credits." } } };
    open();
    fireEvent.click(screen.getByRole("button", { name: /Send now/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not enough SMS credits."));
    expect(handlers.onSent).not.toHaveBeenCalled();
  });

  it("an empty message can be neither sent nor scheduled", () => {
    open();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /Send now/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Schedule send/ })).toBeDisabled();
  });

  it("Schedule send posts the chosen time as ISO and updates the row", async () => {
    responses["/schedule"] = { ok: true, json: { data: { scheduled_send_at: "2026-10-12T04:00:00.000Z" } } };
    open();
    fireEvent.click(screen.getByRole("button", { name: /Schedule send/ }));
    fireEvent.change(screen.getByLabelText("Send at"), { target: { value: "2026-10-12T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
    await waitFor(() => expect(handlers.onUpdated).toHaveBeenCalled());
    const post = calls.find((c) => c.url.endsWith("/schedule"))!;
    expect(post.method).toBe("POST");
    expect(post.body).toEqual({ send_at: new Date("2026-10-12T10:00").toISOString() });
    expect(handlers.onUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: "d1", scheduled_send_at: "2026-10-12T04:00:00.000Z" }));
  });

  it("Skip posts the skip route and hands control back", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Skip step/ }));
    await waitFor(() => expect(handlers.onSkipped).toHaveBeenCalledWith("d1"));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/v1/outreach/drafts/d1/skip"]);
  });

  it("shows why an earlier scheduled send did not go out", () => {
    open({ ...draft, scheduled_error: "This lead has no valid phone number, so it was not sent." } as typeof draft);
    expect(screen.getByText(/no valid phone number/)).toBeInTheDocument();
  });
});
