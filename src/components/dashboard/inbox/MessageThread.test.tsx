// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// S3 item 1 (docs/WHATSAPP-GOLIVE-SONNET-BRIEF.md follow-up): while a send is in
// flight, show an optimistic "Sending…" bubble and disable Send + the attachment
// button; on failure, show an error toast and mark the bubble failed with a Retry.
// Evidence: on stage, a 2.2 MB PDF's first attempt aborted mid-upload
// (ECONNRESET in request.formData()) with no UI signal at all.

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

import { MessageThread } from "./MessageThread";

beforeEach(() => {
  toastError.mockReset();
  // jsdom doesn't implement scrollIntoView; the thread calls it on every render.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const BASE_PROPS = {
  conversation: { id: "conv-1", contact_phone: "+9779800000001" },
  messages: [],
  loading: false,
  currentUserId: "user-1",
  userRole: "admin",
  onApproveDraft: vi.fn(),
};

describe("MessageThread — optimistic send UX (S3)", () => {
  it("shows a 'Sending…' bubble and disables Send + the attachment button while in flight, then clears it on success", async () => {
    let resolveSend: () => void = () => {};
    const onSend = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve; }));
    render(<MessageThread {...BASE_PROPS} onSend={onSend} />);

    fireEvent.change(screen.getByPlaceholderText(/Type a message/), { target: { value: "hello there" } });
    // Click Send (the icon button without a title — last button in the composer row).
    const buttons = screen.getAllByRole("button");
    const sendButton = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendButton); });

    expect(screen.getByText("Sending…")).toBeInTheDocument();
    expect(sendButton).toBeDisabled();
    expect(screen.getByTitle("Attach a file")).toBeDisabled();

    await act(async () => { resolveSend(); await Promise.resolve(); });

    await waitFor(() => expect(screen.queryByText("Sending…")).not.toBeInTheDocument());
    // The attachment button is disabled purely by `sending`, unlike Send (which stays
    // disabled on empty content regardless) — so it's the one that proves the
    // in-flight lock actually released.
    expect(screen.getByTitle("Attach a file")).not.toBeDisabled();
  });

  it("on failure, shows an error toast and keeps a failed bubble with Retry — retry re-sends the same content", async () => {
    const onSend = vi.fn()
      .mockRejectedValueOnce(new Error("aborted ECONNRESET"))
      .mockResolvedValueOnce(undefined);
    render(<MessageThread {...BASE_PROPS} onSend={onSend} />);

    fireEvent.change(screen.getByPlaceholderText(/Type a message/), { target: { value: "hello there" } });
    const buttons = screen.getAllByRole("button");
    const sendButton = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendButton); });

    await waitFor(() => expect(screen.getByText(/Failed — Retry/)).toBeInTheDocument());
    expect(toastError).toHaveBeenCalledWith("Failed to send message");
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello there", undefined, undefined);

    await act(async () => { fireEvent.click(screen.getByText(/Failed — Retry/)); });

    await waitFor(() => expect(screen.queryByText(/Failed — Retry/)).not.toBeInTheDocument());
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenLastCalledWith("hello there", undefined, undefined);
  });
});
