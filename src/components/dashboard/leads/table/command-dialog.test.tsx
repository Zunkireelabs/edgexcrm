// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CommandDialog, type CommandItem } from "./command-dialog";

afterEach(cleanup);
Element.prototype.scrollIntoView = vi.fn(); // jsdom has none

const items: CommandItem[] = [
  { id: "a", label: "Pre-qualified" },
  { id: "b", label: "Qualified" },
];

function Harness({ onSubmit = vi.fn(async () => true) }: { onSubmit?: (ids: string[]) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-bulk="stage" onClick={() => setOpen(true)}>
        Move stage
      </button>
      <CommandDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Move 2 leads to stage"
        placeholder="Search stages…"
        items={items}
        mode="single"
        primaryLabel={(c) => (c[0] ? `Move to ${c[0].label}` : "Move")}
        onSubmit={onSubmit}
        returnFocusTo='[data-bulk="stage"]'
      />
    </>
  );
}

describe("CommandDialog (EDGEX-127)", () => {
  it("primary names the highlighted row, follows the arrow keys, and the chosen row wins", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Move stage"));
    const dialog = await screen.findByTestId("command-dialog");
    expect(screen.getByRole("button", { name: /Move to Pre-qualified/ })).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /Move to Qualified/ })).toBeInTheDocument();
  });

  it("Enter chooses the highlighted row and submits it", async () => {
    const onSubmit = vi.fn(async () => true);
    render(<Harness onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("Move stage"));
    const dialog = await screen.findByTestId("command-dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(["b"]));
  });

  it("returns focus to the opening bulk-bar button on Cancel and on Escape", async () => {
    render(<Harness />);
    const opener = screen.getByText("Move stage");
    fireEvent.click(opener);
    await screen.findByTestId("command-dialog");
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("command-dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());

    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(opener);
    const dialog = await screen.findByTestId("command-dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("command-dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
