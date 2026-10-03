// @vitest-environment jsdom
//
// BulkDraftDialog — confirm + run Send now / Schedule / Skip for many drafts. Pins: the typed confirmation from 50, the
// request each action sends, that skip repeats its batches until none are left (and stops if nothing moves), the sandbox
// warning, and that a failure is shown and leaves the dialog open.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

import { BulkDraftDialog, type BulkDraftAction, type BulkDraftSelection } from "./bulk-draft-dialog";

let bodies: Record<string, unknown>[];
let responses: Array<{ status: number; body: unknown }>;
const okData = (over: Record<string, unknown> = {}) => ({
  status: 200,
  body: { data: { applied: 3, failed: 0, remaining: 0, skipped: { no_subject: 0, no_email: 0, not_available: 0 }, ...over } },
});

beforeEach(() => {
  bodies = [];
  responses = [okData()];
  toastSuccess.mockReset();
  globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const r = responses.length > 1 ? responses.shift()! : responses[0];
    return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
  }) as typeof fetch;
});
vi.mock("@/components/ui/select", async () => await import("./test-select-mock"));

afterEach(cleanup);

const ids = (n: number): BulkDraftSelection => ({ mode: "ids", ids: Array.from({ length: n }, (_, i) => `id-${i}`) });

function open(action: BulkDraftAction, count: number, over: { selection?: BulkDraftSelection; sandbox?: boolean } = {}) {
  const onDone = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <BulkDraftDialog open onOpenChange={onOpenChange} action={action} selection={over.selection ?? ids(count)} count={count} sandbox={over.sandbox ?? false} onDone={onDone} />
  );
  return { onDone, onOpenChange };
}

describe("Send now", () => {
  it("under 50: no confirmation word; sends the ids, no confirm flag; says the emails are queued, then closes and refreshes", async () => {
    const { onDone, onOpenChange } = open("send", 3);
    expect(screen.queryByLabelText(/Type/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send now" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bodies[0]).toEqual({ action: "send", selection: { mode: "ids", ids: ["id-0", "id-1", "id-2"] } });
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/3 emails queued — they go out over the next few minutes/));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("from 50 the button stays disabled until SEND is typed, then the request carries confirm:true", async () => {
    open("send", 120);
    const go = screen.getByRole("button", { name: "Send now" });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "send" } });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ action: "send", confirm: true });
  });

  it("'all matching' sends the filter, not thousands of ids", async () => {
    open("send", 1234, { selection: { mode: "all", due: "today" } });
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "SEND" } });
    fireEvent.click(screen.getByRole("button", { name: "Send now" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ selection: { mode: "all", due: "today" }, confirm: true });
  });

  it("reports what was left out, in plain words", async () => {
    responses = [okData({ applied: 7, skipped: { no_subject: 1, no_email: 2, not_available: 3 } })];
    open("send", 13);
    fireEvent.click(screen.getByRole("button", { name: "Send now" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const msg = String(toastSuccess.mock.calls[0][0]);
    expect(msg).toContain("Left out: 2 with no email, 1 with no subject, 3 no longer available.");
  });

  it("warns that the sandbox sends to the test address — for send and schedule, never for skip", () => {
    open("send", 3, { sandbox: true });
    expect(screen.getByText(/Sandbox is on/)).toBeInTheDocument();
    cleanup();
    open("skip", 3, { sandbox: true });
    expect(screen.queryByText(/Sandbox is on/)).toBeNull();
  });
});

describe("Schedule", () => {
  it("sends the chosen time as an ISO instant and says when", async () => {
    const { onDone } = open("schedule", 3);
    const date = screen.getByLabelText("Send on — date") as HTMLInputElement;
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/); // tomorrow, 9:00 AM by default
    expect(screen.getByLabelText("Send on — time")).toHaveValue("09:00");

    fireEvent.change(date, { target: { value: "2030-01-02" } });
    fireEvent.change(screen.getByLabelText("Send on — time"), { target: { value: "10:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bodies[0]).toMatchObject({ action: "schedule", send_at: new Date("2030-01-02T10:30").toISOString() });
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/3 emails scheduled for/));
  });

  it("can't be submitted without a time", () => {
    open("schedule", 3);
    fireEvent.change(screen.getByLabelText("Send on — date"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Schedule" })).toBeDisabled();
  });
});

describe("Skip", () => {
  it("repeats its batches until none are left, then reports the total", async () => {
    responses = [okData({ applied: 50, remaining: 80 }), okData({ applied: 50, remaining: 30 }), okData({ applied: 30, remaining: 0 })];
    const { onDone } = open("skip", 130, { selection: { mode: "all", due: "all" } });
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "SKIP" } });
    fireEvent.click(screen.getByRole("button", { name: "Skip them" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bodies).toHaveLength(3);
    expect(bodies.every((b) => b.confirm === true)).toBe(true);
    expect(toastSuccess).toHaveBeenCalledWith("Skipped 130 emails");
  });

  it("stops if a round moves nothing (never spins forever) and says how many couldn't be skipped", async () => {
    responses = [okData({ applied: 5, failed: 1, remaining: 4 }), okData({ applied: 0, failed: 0, remaining: 4 })];
    const { onDone } = open("skip", 10);
    fireEvent.click(screen.getByRole("button", { name: "Skip them" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bodies).toHaveLength(2);
    expect(toastSuccess).toHaveBeenCalledWith("Skipped 5 emails (1 couldn't be skipped)");
  });
});

describe("failure", () => {
  it("shows the server's reason, keeps the dialog open and does not refresh the list", async () => {
    responses = [{ status: 422, body: { error: { message: "That is more than 5,000 drafts — narrow it." } } }];
    const { onDone, onOpenChange } = open("send", 3);
    fireEvent.click(screen.getByRole("button", { name: "Send now" }));

    await screen.findByText(/more than 5,000 drafts/);
    expect(onDone).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("a skip that fails AFTER some batches refreshes the list (part of it already happened)", async () => {
    responses = [okData({ applied: 50, remaining: 50 }), { status: 500, body: { error: { message: "Temporary problem" } } }];
    const { onDone } = open("skip", 100, { selection: { mode: "all", due: "all" } });
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "SKIP" } });
    fireEvent.click(screen.getByRole("button", { name: "Skip them" }));

    await screen.findByText("Temporary problem");
    expect(onDone).toHaveBeenCalled();
  });
});
