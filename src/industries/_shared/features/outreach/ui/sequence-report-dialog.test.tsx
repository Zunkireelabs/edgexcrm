// @vitest-environment jsdom
//
// SequenceReportDialog — loads one sequence's report and shows the numbers an admin acts on; explains the two numbers that
// can mislead (delivered trails sent; replies are not tracked when the sequence keeps sending after a reply).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

import { SequenceReportDialog } from "./sequence-report-dialog";

const report = {
  sequence: { id: "seq-1", name: "Welcome", on_reply: "pause" },
  enrollments: { total: 5000, running: 3000, paused: 200, completed: 1500, ended: 300, replied: 250, doNotContact: 40, pausedByStopAll: 120 },
  emails: { sent: 12000, delivered: 11400, bounced: 120, complained: 6 },
  steps: [{ stepOrder: 1, sent: 4800 }, { stepOrder: 2, sent: 4000 }, { stepOrder: 3, sent: 3000 }],
  queue: { dueNow: 800, scheduledLater: 2200 },
  rates: { deliveredPct: 95, bouncedPct: 1, complainedPct: 0.1, repliedPct: 5 },
};

let status: number;
let body: unknown;
beforeEach(() => {
  status = 200;
  body = { data: report };
  globalThis.fetch = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }) as Response) as typeof fetch;
});
afterEach(cleanup);

const open = () => render(<SequenceReportDialog sequence={{ id: "seq-1", name: "Welcome" }} onClose={() => {}} />);

describe("SequenceReportDialog", () => {
  it("shows the counts, the rates, the step funnel and the queue", async () => {
    open();
    await screen.findByText("Leads");
    expect(fetch).toHaveBeenCalledWith("/api/v1/outreach/sequences/seq-1/report");

    expect(screen.getByText("5,000")).toBeInTheDocument(); // in total
    expect(screen.getByText("120 by Pause all")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument(); // sent
    expect(screen.getByText("95%")).toBeInTheDocument(); // delivered
    expect(screen.getByText("5%")).toBeInTheDocument(); // replied
    expect(screen.getByText("Step 2")).toBeInTheDocument();
    expect(screen.getByText("4,000")).toBeInTheDocument();
    expect(screen.getByText(/800 due now/)).toBeInTheDocument();
    expect(screen.getByText(/2,200 scheduled for later/)).toBeInTheDocument();
  });

  it("says replies are not tracked when the sequence keeps sending after a reply", async () => {
    body = { data: { ...report, sequence: { ...report.sequence, on_reply: "continue" }, enrollments: { ...report.enrollments, replied: 0 } } };
    open();
    await screen.findByText(/Not tracked: this sequence keeps sending after a reply/);
  });

  it("explains that delivered trails sent", async () => {
    open();
    await screen.findByText(/can trail/);
  });

  it("shows an error instead of numbers when the report can't be loaded", async () => {
    status = 500;
    body = { error: { message: "Failed to build the report" } };
    open();
    await screen.findByText("Failed to build the report");
    expect(screen.queryByText("Leads")).toBeNull();
  });

  it("renders nothing and makes no request when no sequence is chosen", async () => {
    render(<SequenceReportDialog sequence={null} onClose={() => {}} />);
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });
});
