// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { BlockingNoticeDialog, useBlockingNotice } from "./blocking-notice";

beforeEach(() => toastError.mockReset());
afterEach(cleanup);

describe("BlockingNoticeDialog", () => {
  it("shows the title, message and what is missing, with a hint for each", () => {
    render(
      <BlockingNoticeDialog
        notice={{ title: "Complete the student profile first", message: "Fix these first.", items: [{ label: "a document", hint: "Upload one in the Documents card." }] }}
        onClose={() => {}}
      />
    );

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Complete the student profile first")).toBeInTheDocument();
    expect(screen.getByText("Fix these first.")).toBeInTheDocument();
    expect(screen.getByText("a document")).toBeInTheDocument();
    expect(screen.getByText("Upload one in the Documents card.")).toBeInTheDocument();
  });

  it("renders nothing while there is no notice", () => {
    render(<BlockingNoticeDialog notice={null} onClose={() => {}} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("calls onClose from the 'Got it' button", () => {
    const onClose = vi.fn();
    render(<BlockingNoticeDialog notice={{ title: "T", message: "M" }} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalled();
  });
});

function Harness({ error }: { error: { code?: string; message?: string } }) {
  const { notify, noticeDialog } = useBlockingNotice();
  return (
    <>
      <button onClick={() => notify(error, "fallback")}>go</button>
      {noticeDialog}
    </>
  );
}

describe("useBlockingNotice", () => {
  it("opens the big pop-up (and no toast) for a rule-blocking error, and closes it again", async () => {
    render(<Harness error={{ code: "PROFILE_INCOMPLETE", message: "Complete the student profile before creating an application. Missing: a document" }} />);
    await act(async () => { fireEvent.click(screen.getByText("go")); });

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("a document")).toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Got it" })); });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("falls back to the normal toast for any other error", async () => {
    render(<Harness error={{ code: "DB_ERROR", message: "Failed to save" }} />);
    await act(async () => { fireEvent.click(screen.getByText("go")); });

    expect(toastError).toHaveBeenCalledWith("Failed to save");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
