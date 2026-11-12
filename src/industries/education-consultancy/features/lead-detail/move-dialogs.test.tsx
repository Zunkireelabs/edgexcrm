// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { ArchiveDialog, GpaGateDialog, MoveConfirmDialog, QualifyDialog, type QualifyDialogProps } from "./move-dialogs";

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);

function Qualify({ initial = { dests: [] as string[], course: "" } }: { initial?: { dests: string[]; course: string } }) {
  const [dests, setDests] = useState(initial.dests);
  const [course, setCourse] = useState(initial.course);
  const props: QualifyDialogProps = {
    open: true, onOpenChange: () => {}, leadName: "Sita Karki", destinations: dests, onDestinations: setDests, course, onCourse: setCourse,
    level: "", onLevel: () => {}, note: "", onNote: () => {}, destinationOptions: ["Australia", "Japan"], courseOptions: ["Nursing", "IT"], levelOptions: ["Bachelor"],
    saving: false, onSubmit: vi.fn(),
  };
  return <QualifyDialog {...props} />;
}
const qualifyBtn = () => screen.getByRole("button", { name: /^Qualify/ });

describe("Qualify dialog", () => {
  it("is disabled with nothing set and shows the hint and the banner", () => {
    render(<Qualify />);
    expect(qualifyBtn()).toBeDisabled();
    expect(screen.getByText("Needed: at least one study country or a course.")).toBeInTheDocument();
    expect(screen.getByText("Moves to Qualified and stays with you.")).toBeInTheDocument();
  });
  it("is enabled with a country only", () => {
    render(<Qualify initial={{ dests: ["Australia"], course: "" }} />);
    expect(qualifyBtn()).toBeEnabled();
  });
  it("is enabled with a course only", () => {
    render(<Qualify initial={{ dests: [], course: "Nursing" }} />);
    expect(qualifyBtn()).toBeEnabled();
  });
  it("enables once a course is picked from the dropdown", () => {
    render(<Qualify />);
    fireEvent.click(screen.getByRole("combobox", { name: "Course" }));
    fireEvent.click(screen.getByRole("option", { name: /Nursing/ }));
    expect(qualifyBtn()).toBeEnabled();
  });
});

describe("Archive confirm", () => {
  function Archive({ onConfirm }: { onConfirm: () => void }) {
    const [reason, setReason] = useState("");
    return <ArchiveDialog open leadName="Aarav Shrestha" reason={reason} onReason={setReason} other="" onOther={() => {}} onConfirm={onConfirm} onCancel={() => {}} />;
  }
  it("names the lead, and keeps Archive disabled until a reason is picked", () => {
    const onConfirm = vi.fn();
    render(<Archive onConfirm={onConfirm} />);
    expect(screen.getByText("Archive Aarav Shrestha?")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /^Archive/ });
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByRole("combobox", { name: "Reason" }));
    fireEvent.click(screen.getByRole("option", { name: "Not reachable" }));
    expect(screen.getByRole("button", { name: /^Archive/ })).toBeEnabled();
  });
});

describe("%/GPA gate", () => {
  const lead = { id: "l1" };
  it("shows 'Skip for now' to admins only", () => {
    render(<GpaGateDialog open lead={lead} canSkip targetName="Prospects" onSave={() => {}} onSkip={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();
    cleanup();
    render(<GpaGateDialog open lead={lead} canSkip={false} targetName="Prospects" onSave={() => {}} onSkip={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
  });
  it("needs a %/GPA on a gate-eligible level; SEE does not count", () => {
    const onSave = vi.fn();
    render(<GpaGateDialog open lead={lead} canSkip={false} targetName="Prospects" onSave={onSave} onSkip={() => {}} onCancel={() => {}} />);
    const save = () => screen.getByRole("button", { name: /^Save & continue/ });
    expect(save()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("%/GPA"), { target: { value: "3.2" } });
    expect(save()).toBeEnabled();
    fireEvent.click(screen.getByRole("radio", { name: "SEE" }));
    fireEvent.change(screen.getByLabelText("%/GPA"), { target: { value: "3.9" } });
    // +2 still holds 3.2, so the gate is satisfied; clear it and SEE alone must not unlock.
    fireEvent.click(screen.getByRole("radio", { name: "+2" }));
    fireEvent.change(screen.getByLabelText("%/GPA"), { target: { value: "" } });
    expect(save()).toBeDisabled();
  });
});

describe("send / move / revert confirm", () => {
  const members = [{ user_id: "u1", email: "f@x.test", name: "Farhan Ali" }];
  const base = {
    open: true, targetName: "Prospects", leadName: "Sita Karki", isBackward: false, chainSend: true, members, assignee: "u1", onAssignee: () => {},
    why: "", onWhy: () => {}, fixedHolderName: null, busy: false, onConfirm: () => {}, onCancel: () => {},
  } as const;
  it("Send to Prospects names the preselected person on the button", () => {
    render(<MoveConfirmDialog {...base} direction="next" />);
    expect(screen.getByText("Send to Prospects?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send to Farhan/ })).toBeEnabled();
  });
  it("is disabled when a team exists but nobody is picked", () => {
    render(<MoveConfirmDialog {...base} direction="next" assignee="" />);
    expect(screen.getByRole("button", { name: /^Send/ })).toBeDisabled();
  });
  it("Revert shows the optional Why field", () => {
    render(<MoveConfirmDialog {...base} direction="back" targetName="Pre-qualified" />);
    expect(screen.getByText("Revert to Pre-qualified?")).toBeInTheDocument();
    expect(screen.getByLabelText(/Why/)).toBeInTheDocument();
  });
});
