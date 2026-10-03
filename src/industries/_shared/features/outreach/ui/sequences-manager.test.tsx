// @vitest-environment jsdom
//
// SequencesManager wiring for bulk enroll: every sequence has "Enroll leads" (opens the dialog with the filter
// picker, preset to that sequence); creating a sequence offers "Who should get it?" with Skip for now; an EDIT
// never shows that prompt; Pause all / Resume all are admin-only.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

const refresh = vi.fn();
vi.mock("../hooks/use-sequences", () => ({
  useSequences: () => ({
    loading: false,
    refresh,
    sequences: [
      { id: "seq-1", name: "Welcome", description: null, status: "active", created_at: "2026-10-01T00:00:00Z", auto_send: false, on_reply: "pause", email_sequence_steps: [] },
      { id: "seq-new", name: "Brand new", description: null, status: "active", created_at: "2026-10-03T00:00:00Z", auto_send: true, on_reply: "pause", email_sequence_steps: [] },
    ],
  }),
}));

// the editor stub just reports a save — what the manager does with it is under test
vi.mock("./sequence-editor-dialog", () => ({
  SequenceEditorDialog: ({ open, onSaved }: { open: boolean; onSaved: (s?: { id: string; name: string; created: boolean }) => void }) =>
    open ? (
      <div>
        <button onClick={() => onSaved({ id: "seq-new", name: "Brand new", created: true })}>save-created</button>
        <button onClick={() => onSaved({ id: "seq-1", name: "Welcome", created: false })}>save-edited</button>
      </div>
    ) : null,
}));

const dialogProps = vi.fn();
vi.mock("./bulk-enroll-dialog", () => ({
  BulkEnrollDialog: (props: Record<string, unknown>) => {
    dialogProps(props);
    return <div data-testid="bulk-dialog">{String(props.sourceLabel)}</div>;
  },
}));
vi.mock("./sequence-pause-dialog", () => ({ SequencePauseDialog: () => null }));
vi.mock("./sequence-report-dialog", () => ({
  SequenceReportDialog: ({ sequence }: { sequence: { name: string } | null }) => (sequence ? <div data-testid="report-dialog">{sequence.name}</div> : null),
}));

import { SequencesManager } from "./sequences-manager";

beforeEach(() => {
  refresh.mockClear();
  dialogProps.mockClear();
});
afterEach(cleanup);

describe("SequencesManager — bulk enroll entry points", () => {
  it("'Enroll leads' on a sequence opens the dialog with the filter picker, preset to that sequence", () => {
    render(<SequencesManager isAdmin industryId="education_consultancy" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Enroll leads" })[0]);

    expect(screen.getByTestId("bulk-dialog")).toHaveTextContent("Enroll leads in “Welcome”");
    expect(dialogProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ presetSequenceId: "seq-1", audiencePicker: { industryId: "education_consultancy", isAdmin: true } }),
    );
  });

  it("a non-admin can still enroll leads (same as the single-lead enroll) but sees no Pause all / Resume all", () => {
    render(<SequencesManager isAdmin={false} industryId="education_consultancy" />);
    expect(screen.getAllByRole("button", { name: "Enroll leads" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Pause all" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume all" })).toBeNull();
  });

  it("creating a sequence offers 'Who should get it?'; Choose leads opens the dialog for the new sequence", () => {
    render(<SequencesManager isAdmin industryId="education_consultancy" />);
    fireEvent.click(screen.getByRole("button", { name: /New sequence/ }));
    fireEvent.click(screen.getByText("save-created"));

    expect(refresh).toHaveBeenCalled();
    expect(screen.getByText(/Who should get/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose leads" }));

    expect(dialogProps).toHaveBeenLastCalledWith(expect.objectContaining({ presetSequenceId: "seq-new" }));
  });

  it("'Skip for now' closes the prompt without opening the dialog", () => {
    render(<SequencesManager isAdmin industryId="education_consultancy" />);
    fireEvent.click(screen.getByRole("button", { name: /New sequence/ }));
    fireEvent.click(screen.getByText("save-created"));
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(screen.queryByText(/Who should get/)).toBeNull();
    expect(screen.queryByTestId("bulk-dialog")).toBeNull();
  });

  it("editing an existing sequence never shows the prompt", () => {
    render(<SequencesManager isAdmin industryId="education_consultancy" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.click(screen.getByText("save-edited"));

    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText(/Who should get/)).toBeNull();
  });

  it("admins get Pause all and Resume all on every sequence", () => {
    render(<SequencesManager isAdmin industryId="education_consultancy" />);
    expect(screen.getAllByRole("button", { name: "Pause all" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Resume all" })).toHaveLength(2);
  });

  it("admins get a Report button that opens the report for that sequence; non-admins do not see it", () => {
    const { unmount } = render(<SequencesManager isAdmin industryId="education_consultancy" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Report" })[1]);
    expect(screen.getByTestId("report-dialog")).toHaveTextContent("Brand new");
    unmount();

    render(<SequencesManager isAdmin={false} industryId="education_consultancy" />);
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
  });
});
