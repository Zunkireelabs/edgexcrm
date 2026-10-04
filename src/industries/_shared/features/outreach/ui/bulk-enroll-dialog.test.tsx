// @vitest-environment jsdom
//
// BulkEnrollDialog — the screen between a click and thousands of enrollments. Pins: the preview is requested with
// the right audience + policy, nothing is started without the typed confirmation from 100 leads, the policy
// choice only appears when someone is in another sequence (and re-previews), the filter-picker mode never
// previews an EMPTY filter, and the result offers the skipped download.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

vi.mock("../hooks/use-sequences", () => ({
  useSequences: () => ({
    loading: false,
    refresh: vi.fn(),
    sequences: [
      { id: "seq-1", name: "Welcome", auto_send: false },
      { id: "seq-2", name: "Nurture", auto_send: true },
    ],
  }),
}));

// Radix Select needs pointer events jsdom lacks — a native <select> with the same props is enough here.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: React.ReactNode }) => (
    <select aria-label="Sequence" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">—</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

// the real picker is the shared filter bar (covered elsewhere): a stub that lets the test emit trees
let emitTree: ((tree: unknown) => void) | null = null;
vi.mock("./audience-picker", () => ({
  AudienceFilterPicker: ({ onChange }: { onChange: (t: unknown) => void }) => {
    emitTree = onChange;
    return <div data-testid="picker" />;
  },
}));

import { BulkEnrollDialog } from "./bulk-enroll-dialog";

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}
let calls: Call[];
let previewData: Record<string, unknown>;
let runData: Record<string, unknown>;

const basePreview = {
  matched: 120,
  notVisible: 0,
  willEnroll: 120,
  skipped: { noEmail: 3, malformedEmail: 0, duplicateEmail: 0, suppressed: 2, alreadyInSequence: 0 },
  conflictPolicy: "skip",
  inOtherSequence: 0,
  willSwitch: 0,
  willQueue: 0,
  overLimit: false,
  limit: 10000,
  confirmFrom: 100,
  cap: { dailyCap: 2000, sentToday: 0, remaining: 2000 },
  estimatedExtraDays: 0,
  sandbox: true,
  sendingEnabled: true,
  sampleNames: ["Sita Rai"],
  sequence: { id: "seq-1", name: "Welcome", auto_send: false },
};

beforeEach(() => {
  calls = [];
  emitTree = null;
  previewData = { ...basePreview };
  runData = {
    id: "run-1", status: "completed", total_count: 120, enrolled_count: 118, skipped_count: 5, failed_count: 2,
    cancel_requested: false, error: null, queued_count: 0,
  };
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url: u, method: init?.method ?? "GET", body });
    const ok = (data: unknown, status = 200) => ({ ok: true, status, json: async () => ({ data }) }) as Response;
    if (u.endsWith("/bulk-enroll/preview")) return ok(previewData);
    if (u.endsWith("/bulk-enroll") && init?.method === "POST") return ok({ run_id: "run-1", will_enroll: previewData.willEnroll }, 201);
    if (u.includes("/bulk-enroll/run-1")) return ok(runData);
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as typeof fetch;
});

afterEach(cleanup);

const previewCalls = () => calls.filter((c) => c.url.endsWith("/bulk-enroll/preview"));
const selected = { mode: "selected" as const, leadIds: ["l1", "l2"] };

const open = (props: Partial<React.ComponentProps<typeof BulkEnrollDialog>> = {}) =>
  render(<BulkEnrollDialog open onOpenChange={() => {}} source={selected} sourceLabel="2 selected leads" {...props} />);

describe("BulkEnrollDialog — selected rows", () => {
  it("previews the picked audience for the chosen sequence and shows the numbers", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Sequence"), { target: { value: "seq-1" } });

    await screen.findByText(/will be enrolled/);
    expect(previewCalls()).toHaveLength(1);
    expect(previewCalls()[0].body).toEqual({
      sequence_id: "seq-1",
      source: { mode: "selected", lead_ids: ["l1", "l2"] },
      conflict_policy: "skip",
    });
    expect(screen.getByText("No email address")).toBeInTheDocument();
    expect(screen.getByText("Unsubscribed or bounced")).toBeInTheDocument();
  });

  it("from 100 leads Start stays disabled until ENROLL is typed, then starts with confirm:true and shows the result", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Sequence"), { target: { value: "seq-1" } });
    await screen.findByText(/will be enrolled/);

    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: "enroll" } });
    expect(start).toBeEnabled();

    fireEvent.click(start);

    await screen.findByText("Done.");
    const startCall = calls.find((c) => c.url.endsWith("/bulk-enroll") && c.method === "POST")!;
    expect(startCall.body).toMatchObject({ sequence_id: "seq-1", conflict_policy: "skip", confirm: true });
    expect(screen.getByText(/Enrolled 118/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download skipped leads/ })).toHaveAttribute(
      "href",
      "/api/v1/outreach/bulk-enroll/run-1/skipped",
    );
  });

  it("under 100 leads no confirmation word is needed, and confirm is not sent", async () => {
    previewData = { ...basePreview, willEnroll: 40, matched: 40 };
    open();
    fireEvent.change(screen.getByLabelText("Sequence"), { target: { value: "seq-1" } });
    await screen.findByText(/will be enrolled/);

    expect(screen.queryByLabelText(/Type/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByText("Done.");
    expect(calls.find((c) => c.url.endsWith("/bulk-enroll") && c.method === "POST")!.body).not.toHaveProperty("confirm");
  });

  it("blocks Start when nobody can be enrolled or the run is over the limit", async () => {
    previewData = { ...basePreview, willEnroll: 0, matched: 5 };
    open();
    fireEvent.change(screen.getByLabelText("Sequence"), { target: { value: "seq-1" } });
    await screen.findByText(/will be enrolled/);
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();

    cleanup();
    previewData = { ...basePreview, willEnroll: 10001, overLimit: true };
    open();
    fireEvent.change(screen.getByLabelText("Sequence"), { target: { value: "seq-1" } });
    await screen.findByText(/more than the 10,000/);
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });
});

describe("BulkEnrollDialog — conflict policy", () => {
  it("offers skip / switch / queue only when someone is in another sequence, and re-previews with the choice", async () => {
    previewData = { ...basePreview, willEnroll: 40, inOtherSequence: 12 };
    open();
    fireEvent.change(screen.getByLabelText("Sequence"), { target: { value: "seq-1" } });
    await screen.findByText(/12 leads are already in another sequence/);

    expect(screen.getByRole("radio", { name: /Skip them/ })).toBeChecked();
    previewData = { ...basePreview, willEnroll: 52, inOtherSequence: 12, willSwitch: 12, conflictPolicy: "switch" };
    fireEvent.click(screen.getByRole("radio", { name: /Switch them/ }));

    await waitFor(() => expect(previewCalls()).toHaveLength(2));
    expect(previewCalls()[1].body).toMatchObject({ conflict_policy: "switch" });
    await screen.findByText(/12 of them leave their current sequence/);
  });

  it("does not show the choice when nobody is in another sequence", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Sequence"), { target: { value: "seq-1" } });
    await screen.findByText(/will be enrolled/);
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("tells the rep when the first emails will go out when the sequence has a send window", async () => {
    previewData = { ...basePreview, sequence: { id: "seq-1", name: "Welcome", auto_send: false, send_window_text: "Mon, Tue, Wed, Thu, Fri at 10:00 AM–12:00 PM" } };
    open();
    fireEvent.change(screen.getByLabelText("Sequence"), { target: { value: "seq-1" } });
    await screen.findByText(/This sequence sends Mon, Tue, Wed, Thu, Fri at 10:00 AM–12:00 PM/);
    expect(screen.getByText(/first emails wait/)).toBeInTheDocument();
  });

  it("warns when the sequence is auto-send and the sandbox is off", async () => {
    previewData = { ...basePreview, sandbox: false, sequence: { id: "seq-2", name: "Nurture", auto_send: true } };
    open();
    fireEvent.change(screen.getByLabelText("Sequence"), { target: { value: "seq-2" } });
    await screen.findByText(/nobody reviews the emails/);
    expect(screen.getByText(/real leads, not a test address/)).toBeInTheDocument();
  });
});

describe("BulkEnrollDialog — started from a sequence (filter picker)", () => {
  it("never previews an empty filter; previews once at least one condition exists, sending the filter tree", async () => {
    open({ source: undefined, audiencePicker: { industryId: "education_consultancy", isAdmin: true }, presetSequenceId: "seq-1" });
    await screen.findByTestId("picker");
    expect(screen.getByText(/Add at least one filter/)).toBeInTheDocument();

    emitTree!({ id: "root", conjunction: "and", conditions: [] }); // empty = "every lead": must NOT preview
    await new Promise((r) => setTimeout(r, 800));
    expect(previewCalls()).toHaveLength(0);

    const tree = { id: "root", conjunction: "and", conditions: [{ id: "c1", field: "status", op: "is", value: "new" }] };
    emitTree!(tree);
    await screen.findByText(/will be enrolled/, undefined, { timeout: 3000 });
    expect(previewCalls()).toHaveLength(1);
    expect(previewCalls()[0].body).toMatchObject({ sequence_id: "seq-1", source: { mode: "filter", tree } });
  });
});
