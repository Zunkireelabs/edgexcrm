// @vitest-environment jsdom
//
// EDGEX-145 Dialogs v1: the shared shell. Pins the `size` prop, the footer's button restyle hooks (Button exposes
// data-variant, the footer styles by it), the flush escape hatch for p-0 consumers, the transparent overlay, and the
// AlertDialog header/icon + the action's destructive inference.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogKeyHint, DialogTitle } from "./dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./alert-dialog";
import { Button } from "./button";
import { DIALOG_FOOTER } from "./dialog-shell";

afterEach(cleanup);

const open = (content: Partial<React.ComponentProps<typeof DialogContent>> = {}) =>
  render(
    <Dialog open>
      <DialogContent {...content}>
        <DialogHeader>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Context</DialogDescription>
        </DialogHeader>
        <p>Body</p>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Save</Button>
          <Button variant="destructive">Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  );

describe("DialogContent size", () => {
  it("defaults to md (560) and honours sm / lg (440 / 720)", () => {
    open();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-size", "md");
    expect(screen.getByRole("dialog").className).toContain("max-w-[min(560px,calc(100%-2rem))]");
    cleanup();
    open({ size: "sm" });
    expect(screen.getByRole("dialog").className).toContain("max-w-[min(440px,calc(100%-2rem))]");
    cleanup();
    open({ size: "lg" });
    expect(screen.getByRole("dialog").className).toContain("max-w-[min(720px,calc(100%-2rem))]");
  });

  it("drops the size default when a consumer passes any plain max-w-*, and keeps a consumer sm:max-w-*", () => {
    open({ className: "max-w-md" });
    expect(screen.getByRole("dialog").className).not.toContain("560px");
    expect(screen.getByRole("dialog").className).toContain("max-w-md");
    cleanup();
    open({ className: "sm:max-w-[425px]" });
    expect(screen.getByRole("dialog").className).toContain("sm:max-w-[425px]");
    cleanup();
    open();
    expect(screen.getByRole("dialog").className).toContain("560px");
  });

  it("lets a consumer className still land on the OUTER element", () => {
    open({ className: "sm:max-w-5xl" });
    expect(screen.getByRole("dialog").className).toContain("sm:max-w-5xl");
  });

  it("has no grey page overlay and keeps the frosted 4px ring even when the consumer says p-0", () => {
    open({ className: "p-0" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("p-1!");
    expect(document.querySelector("[data-slot=dialog-overlay]")?.className).toContain("bg-transparent");
    expect(document.querySelector("[data-slot=dialog-overlay]")?.className).not.toContain("bg-black");
  });
});

describe("flush", () => {
  it("applies body margins by default and drops them for p-0 / flush consumers", () => {
    open();
    expect(document.querySelector("[data-slot=dialog-scroll]")?.className).toContain("gap-5");
    cleanup();
    open({ className: "p-0" });
    expect(document.querySelector("[data-slot=dialog-scroll]")?.className).toContain("gap-0");
    cleanup();
    open({ flush: true });
    expect(document.querySelector("[data-slot=dialog-scroll]")?.className).toContain("gap-0");
  });
});

describe("DialogFooter button restyle", () => {
  it("exposes each button's variant for the footer styles and carries the restyle rules", () => {
    open();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("data-variant", "outline");
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("data-variant", "default");
    expect(screen.getByRole("button", { name: "Remove" })).toHaveAttribute("data-variant", "destructive");
    const footer = document.querySelector("[data-slot=dialog-footer]")!;
    expect(footer.className).toContain("min-h-[52px]");
    // outline -> ghost Cancel, default -> blue primary, destructive -> solid red
    expect(DIALOG_FOOTER).toContain("[data-variant=outline]]:bg-transparent");
    expect(DIALOG_FOOTER).toContain("[data-variant=default]]:bg-ds-accent");
    expect(DIALOG_FOOTER).toContain("[data-variant=destructive]]:bg-ds-bad");
  });

  it("renders the key hint box inside a primary button", () => {
    render(
      <Button>
        Archive <DialogKeyHint>↵</DialogKeyHint>
      </Button>,
    );
    expect(screen.getByText("↵").tagName).toBe("KBD");
  });
});

describe("DialogHeader", () => {
  it("is a left-aligned bar with the description under the title", () => {
    open();
    const header = document.querySelector("[data-slot=dialog-header]")!;
    expect(header.className).toContain("min-h-12");
    expect(header.className).toContain("text-left");
    expect(header.className).not.toContain("text-center");
    expect(header).toContainElement(screen.getByText("Context"));
  });
});

describe("AlertDialog", () => {
  const alert = (icon?: React.ReactNode) =>
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader icon={icon} tone="danger">
            <AlertDialogTitle>Archive 2 leads?</AlertDialogTitle>
            <AlertDialogDescription>They leave every stage.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white">Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

  it("defaults to the small shell, shows the icon badge, and marks red-painted actions destructive", () => {
    alert(<svg data-testid="ic" />);
    expect(screen.getByRole("alertdialog")).toHaveAttribute("data-size", "sm");
    expect(screen.getByTestId("ic").parentElement).toHaveAttribute("data-tone", "danger");
    expect(screen.getByRole("button", { name: "Archive" })).toHaveAttribute("data-variant", "destructive");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("data-variant", "outline");
    expect(document.querySelector("[data-slot=alert-dialog-overlay]")?.className).toContain("bg-transparent");
  });
});
