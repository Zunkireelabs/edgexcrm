// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HandoverDialog } from "./HandoverDialog";

afterEach(cleanup);

const MEMBERS = [
  { user_id: "me", name: "Manish Sah" },
  { user_id: "bijay", name: "Bijay Dahal" },
  { user_id: "sadin", name: "Sadin Shrestha" },
];

function show(over: Partial<React.ComponentProps<typeof HandoverDialog>> = {}) {
  const onConfirm = vi.fn(async () => {});
  const onOpenChange = vi.fn();
  const r = render(
    <HandoverDialog open onOpenChange={onOpenChange} members={MEMBERS} currentUserId="me" contactName="Ram Sharma" onConfirm={onConfirm} {...over} />,
  );
  return { onConfirm, onOpenChange, ...r };
}

describe("HandoverDialog", () => {
  it("names the visitor and lists teammates but not yourself", () => {
    show();
    expect(screen.getByText(/Who should handle Ram Sharma's chat/)).toBeInTheDocument();
    const options = Array.from(screen.getByLabelText("Hand over to").querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Choose a teammate…", "Bijay Dahal", "Sadin Shrestha"]);
  });

  it("can't hand over until someone is chosen", () => {
    show();
    expect(screen.getByRole("button", { name: "Hand over" })).toBeDisabled();
  });

  it("hands over to the chosen person", async () => {
    const { onConfirm } = show();
    fireEvent.change(screen.getByLabelText("Hand over to"), { target: { value: "bijay" } });
    fireEvent.click(screen.getByRole("button", { name: "Hand over" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("bijay"));
  });

  it("Cancel closes it without handing over", () => {
    const { onConfirm, onOpenChange } = show();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("says so when there is nobody else who can take the chat", () => {
    show({ members: [{ user_id: "me", name: "Manish Sah" }] });
    expect(screen.getByText(/nobody else who can open the Inbox/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hand over" })).toBeDisabled();
  });

  it("starts with no choice each time it opens", () => {
    const { rerender, onConfirm, onOpenChange } = show();
    fireEvent.change(screen.getByLabelText("Hand over to"), { target: { value: "bijay" } });
    rerender(<HandoverDialog open={false} onOpenChange={onOpenChange} members={MEMBERS} currentUserId="me" contactName="Ram" onConfirm={onConfirm} />);
    rerender(<HandoverDialog open onOpenChange={onOpenChange} members={MEMBERS} currentUserId="me" contactName="Ram" onConfirm={onConfirm} />);
    expect((screen.getByLabelText("Hand over to") as HTMLSelectElement).value).toBe("");
  });
});
