// @vitest-environment jsdom
//
// SequenceEditorDialog — editing a sequence that leads are running (Outreach Phase 5). Steps leads have reached are
// marked "In use" and their order / wait / drafting controls are locked (wording stays editable); later steps stay free;
// a sequence nobody is running has nothing locked; creating a new one never asks for a lock. The 409 message from the
// server is shown as-is.

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
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn(), message: vi.fn() } }));

// the rich editors are not under test
vi.mock("@/industries/_shared/features/email/components/tiptap-editor", () => ({ TipTapEditor: () => <div data-testid="tiptap" /> }));
vi.mock("@/industries/_shared/features/email/components/html-source-editor", () => ({ HtmlSourceEditor: () => <div data-testid="html" /> }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

import { SequenceEditorDialog } from "./sequence-editor-dialog";
import type { Sequence } from "../hooks/use-sequences";

const sequence: Sequence = {
  id: "seq-1", name: "Welcome", description: null, status: "active", created_at: "2026-10-01T00:00:00Z", auto_send: false, on_reply: "pause", send_window: null,
  email_sequence_steps: [1, 2, 3, 4].map((n) => ({
    id: `st-${n}`, step_order: n, delay_days: n === 1 ? 0 : n, subject_template: `Subject ${n}`, body_template: `<p>Body ${n}</p>`, draft_source: "template" as const, ai_instructions: null,
  })),
};

let fetchCalls: string[];
let lock: { locked_up_to: number; live_enrollments: number };
let patchResponse: { status: number; body: unknown };

beforeEach(() => {
  fetchCalls = [];
  toastError.mockReset();
  lock = { locked_up_to: 2, live_enrollments: 1500 };
  patchResponse = { status: 200, body: { data: {} } };
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    fetchCalls.push(`${init?.method ?? "GET"} ${u}`);
    if (u.includes("send-window-defaults")) return { ok: true, json: async () => ({ data: { timezone: "Asia/Kathmandu", window: { time: "10:00", days: [0, 1, 2, 3, 4, 5], timezone_mode: "lead", spread_minutes: 120 } } }) } as Response;
    if (init?.method === "PATCH") return { ok: patchResponse.status < 400, status: patchResponse.status, json: async () => patchResponse.body } as Response;
    if (u.endsWith("/sequences/seq-1")) return { ok: true, json: async () => ({ data: { ...sequence, ...lock } }) } as Response;
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as typeof fetch;
});
afterEach(cleanup);

const open = (seq: Sequence | null = sequence) => render(<SequenceEditorDialog open onOpenChange={() => {}} sequence={seq} onSaved={() => {}} industryId="education_consultancy" />);
const waitInputs = (n: number) => waitFor(() => expect(screen.getAllByRole("spinbutton")).toHaveLength(n));

describe("SequenceEditorDialog — steps in use", () => {
  it("marks the steps leads have reached 'In use', explains why, and leaves later steps free", async () => {
    open();
    await screen.findByText(/1,500 leads are running this sequence/);
    expect(screen.getByText(/Steps 1–2 are\s+in use/)).toBeInTheDocument();
    expect(screen.getAllByText("In use")).toHaveLength(2);
  });

  it("locks the wait, drafting, move and delete controls of an in-use step — not of a free one", async () => {
    open();
    await screen.findAllByText("In use");
    await waitInputs(3); // waits for steps 2, 3, 4 (step 1 has no wait box)
    const waits = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(waits[0]).toBeDisabled(); // step 2: in use
    expect(waits[1]).toBeEnabled(); // step 3: free
    expect(waits[2]).toBeEnabled(); // step 4: free

    const aiBoxes = screen.getAllByRole("checkbox", { name: /Auto-draft with AI/ });
    expect(aiBoxes[0]).toBeDisabled();
    expect(aiBoxes[1]).toBeDisabled();
    expect(aiBoxes[2]).toBeEnabled();
    expect(aiBoxes[3]).toBeEnabled();
  });

  it("the wording of an in-use step is still editable", async () => {
    open();
    await screen.findAllByText("In use");
    expect(screen.getAllByPlaceholderText(/Quick question/)[0]).toBeEnabled();
  });

  it("a sequence nobody is running has nothing locked and no banner", async () => {
    lock = { locked_up_to: 0, live_enrollments: 0 };
    open();
    await waitFor(() => expect(fetchCalls.some((c) => c.endsWith("/sequences/seq-1"))).toBe(true));
    expect(screen.queryByText("In use")).toBeNull();
    expect(screen.queryByText(/are running this sequence/)).toBeNull();
    expect((screen.getAllByRole("spinbutton") as HTMLInputElement[]).every((i) => !i.disabled)).toBe(true);
  });

  it("creating a new sequence never asks for a lock", async () => {
    open(null);
    await waitFor(() => expect(fetchCalls.some((c) => c.includes("send-window-defaults"))).toBe(true));
    expect(fetchCalls.some((c) => /\/sequences\/[\w-]+$/.test(c))).toBe(false);
    expect(screen.queryByText("In use")).toBeNull();
  });

  it("shows the server's own explanation when a save is refused (409)", async () => {
    patchResponse = { status: 409, body: { error: { message: "Steps 1–2 are already in use by leads in this sequence, so their order can't change." } } };
    open();
    await screen.findAllByText("In use");
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Steps 1–2 are already in use/)));
  });
});
