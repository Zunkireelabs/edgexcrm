// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { rememberOrigin } from "./focus-origin";
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
    expect(screen.getByText("Qualified").tagName).toBe("B");
    expect(screen.getByText(/stays with you\./).textContent).toBe("Moves to Qualified and stays with you.");
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

describe("dialog bar and fixed-height notes", () => {
  it("the bar is left-aligned with a blue icon, name inline", () => {
    render(<Qualify />);
    const bar = screen.getByText("Qualify", { selector: "[data-slot=dialog-title]" }).closest("[data-slot=dialog-header]") as HTMLElement;
    expect(bar.className).toContain("justify-start");
    expect(bar.querySelector("svg")?.getAttribute("class")).toContain("text-[#266df0]");
    expect(within(bar).getByText("Sita Karki")).toBeInTheDocument();
  });
  it("the note textarea carries the important height classes that beat the unlayered dialog textarea rule", () => {
    render(<Qualify />);
    const cls = screen.getByLabelText(/Note/).className;
    expect(cls).toContain("!h-16");
    expect(cls).toContain("!min-h-16");
    expect(cls).toContain("!field-sizing-fixed");
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
    render(<GpaGateDialog open lead={lead} canSkip onSave={() => {}} onSkip={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();
    cleanup();
    render(<GpaGateDialog open lead={lead} canSkip={false} onSave={() => {}} onSkip={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("button", { name: "Skip for now" })).toBeNull();
  });
  it("needs a %/GPA on a gate-eligible level; SEE does not count", () => {
    const onSave = vi.fn();
    render(<GpaGateDialog open lead={lead} canSkip={false} onSave={onSave} onSkip={() => {}} onCancel={() => {}} />);
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

// Requirement 9: every dialog hands focus back to the button (or menu button) that started the flow.
describe("focus returns to the trigger", () => {
  function Flow({ children }: { children: (open: boolean, close: () => void) => React.ReactNode }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={(e) => { rememberOrigin(e.currentTarget); setOpen(true); }}>Trigger</button>
        {children(open, () => setOpen(false))}
      </>
    );
  }
  const expectFocusOnTrigger = async () => {
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Trigger" })));
  };

  it("Qualify: Esc and Cancel both return focus to the trigger", async () => {
    const view = (key: string) => (
      <Flow>{(open, close) => <QualifyDialog open={open} onOpenChange={(o) => !o && close()} leadName="Sita" destinations={[]} onDestinations={() => {}} course="" onCourse={() => {}} level="" onLevel={() => {}} note="" onNote={() => {}} destinationOptions={[]} courseOptions={[]} levelOptions={[]} saving={false} onSubmit={() => {}} key={key} />}</Flow>
    );
    render(view("a"));
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    await expectFocusOnTrigger();
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await expectFocusOnTrigger();
  });

  it("Archive (alert dialog): focus starts INSIDE the dialog, and Cancel returns it to the trigger", async () => {
    render(<Flow>{(open, close) => open && <ArchiveDialog open leadName="Aarav" reason="" onReason={() => {}} other="" onOther={() => {}} onConfirm={() => {}} onCancel={close} />}</Flow>);
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    const box = await screen.findByRole("alertdialog");
    await waitFor(() => expect(box.contains(document.activeElement)).toBe(true));
    fireEvent.click(within(box).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Trigger" })));
  });

  it("a chain returns to the ORIGINAL trigger (gate → confirm → Cancel)", async () => {
    function Chain() {
      const [step, setStep] = useState<"none" | "gate" | "confirm">("none");
      return (
        <>
          <button type="button" onClick={(e) => { rememberOrigin(e.currentTarget); setStep("gate"); }}>Trigger</button>
          <GpaGateDialog open={step === "gate"} lead={{ id: "l" }} canSkip onSave={() => setStep("confirm")} onSkip={() => setStep("confirm")} onCancel={() => setStep("none")} />
          <MoveConfirmDialog open={step === "confirm"} direction="next" targetName="Prospects" leadName="Sita" isBackward={false} chainSend members={[]} assignee="" onAssignee={() => {}} why="" onWhy={() => {}} fixedHolderName={null} busy={false} onConfirm={() => {}} onCancel={() => setStep("none")} />
        </>
      );
    }
    render(<Chain />);
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
    const box = await screen.findByRole("alertdialog");
    fireEvent.click(within(box).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Trigger" })));
  });
});
