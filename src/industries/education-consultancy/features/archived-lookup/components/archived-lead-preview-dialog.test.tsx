// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PERMISSION_DENIED_MESSAGE } from "@/lib/permission-denied";
import type { ArchivedLeadPreview } from "../lib/types";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));
vi.mock("next/link", () => ({
  default: ({ children, href, onClick }: { children: React.ReactNode; href: string; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>{children}</a>
  ),
}));

import { ArchivedLeadPreviewDialog } from "./archived-lead-preview-dialog";

const lead = (over: Partial<ArchivedLeadPreview> = {}): ArchivedLeadPreview => ({
  id: "lead-1", first_name: "Abdul", last_name: "Rahim", email: "abdul@example.com", phone: "+977-9800000000",
  archive_reason: "No response after 3 calls", archived_at: "2026-10-05T10:00:00Z", archived_from_list_name: "Qualified",
  assigned_to_name: "Sita Sharma", created_at: "2026-10-01T00:00:00Z", can_open: false, can_restore: true, ...over,
});

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

function setup(l: ArchivedLeadPreview | null, fetchImpl?: () => Promise<Response>) {
  global.fetch = vi.fn(fetchImpl ?? (async () => ({ ok: true, status: 200, json: async () => ({ data: { list_name: "Qualified" } }) }) as Response)) as unknown as typeof fetch;
  const onClose = vi.fn();
  const onRestored = vi.fn();
  render(<ArchivedLeadPreviewDialog lead={l} onClose={onClose} onRestored={onRestored} />);
  return { onClose, onRestored };
}
const restoreButton = () => screen.getByRole("button", { name: /Move back to pipeline/ });

describe("ArchivedLeadPreviewDialog — what it shows", () => {
  it("renders nothing when there is no lead", () => {
    setup(null);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows who it is, the Archived badge, contact, counselor, origin stage, reason and date", () => {
    setup(lead());
    expect(screen.getByText("Abdul Rahim")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("abdul@example.com")).toBeInTheDocument();
    expect(screen.getByText("+977-9800000000")).toBeInTheDocument();
    expect(screen.getByText("Sita Sharma")).toBeInTheDocument();
    expect(screen.getAllByText("Qualified").length).toBeGreaterThan(0);
    expect(screen.getByText("No response after 3 calls")).toBeInTheDocument();
  });

  it("says so when there is no reason, no assignee and no remembered stage", () => {
    setup(lead({ archive_reason: null, assigned_to_name: null, archived_from_list_name: null, archived_at: null }));
    expect(screen.getByText("No reason recorded")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText(/It goes back to the first stage/)).toBeInTheDocument();
  });

  it("states where it will go and that the counselor stays", () => {
    setup(lead());
    expect(screen.getByText(/It goes back to Qualified and stays with Sita Sharma/)).toBeInTheDocument();
  });

  it("falls back to the email when there is no name", () => {
    setup(lead({ first_name: null, last_name: null }));
    expect(screen.getAllByText("abdul@example.com").length).toBeGreaterThan(0);
  });
});

describe("ArchivedLeadPreviewDialog — buttons by permission", () => {
  it("offers 'Open lead' only when the user may open the lead page", () => {
    setup(lead({ can_open: true }));
    expect(screen.getByRole("link", { name: "Open lead" })).toHaveAttribute("href", "/leads/lead-1");
  });
  it("hides 'Open lead' otherwise (it would be a dead end)", () => {
    setup(lead({ can_open: false }));
    expect(screen.queryByRole("link", { name: "Open lead" })).toBeNull();
  });
  it("a view-only user gets no restore button, and is told why", () => {
    setup(lead({ can_restore: false }));
    expect(screen.queryByRole("button", { name: /Move back to pipeline/ })).toBeNull();
    expect(screen.getByText(/view this lead but not move it/)).toBeInTheDocument();
  });
});

describe("ArchivedLeadPreviewDialog — Move back to pipeline", () => {
  it("POSTs the restore, tells the user where it went, drops it from the results and closes", async () => {
    const { onClose, onRestored } = setup(lead());
    fireEvent.click(restoreButton());
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith("lead-1"));
    expect(global.fetch).toHaveBeenCalledWith("/api/v1/archived-leads/lead-1/restore", { method: "POST" });
    expect(toastSuccess).toHaveBeenCalledWith("Abdul Rahim moved back to Qualified");
    expect(onClose).toHaveBeenCalled();
  });

  it("a 403 shows the standard no-permission message and keeps the panel open", async () => {
    const { onClose, onRestored } = setup(lead(), async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "x" } }) }) as Response);
    fireEvent.click(restoreButton());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(PERMISSION_DENIED_MESSAGE));
    expect(onRestored).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a conflict shows the server's own explanation", async () => {
    setup(lead(), async () => ({ ok: false, status: 409, json: async () => ({ error: { message: "This lead was just changed by someone else. Refresh and try again." } }) }) as Response);
    fireEvent.click(restoreButton());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("This lead was just changed by someone else. Refresh and try again."));
  });

  it("a network failure shows a plain failure message and keeps the panel open", async () => {
    const { onClose } = setup(lead(), async () => { throw new Error("offline"); });
    fireEvent.click(restoreButton());
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Failed to move the lead back to the pipeline"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables the button while the move is running (no double click)", async () => {
    let finish: (r: Response) => void = () => {};
    setup(lead(), () => new Promise<Response>((resolve) => { finish = resolve; }));
    fireEvent.click(restoreButton());
    await waitFor(() => expect(restoreButton()).toBeDisabled());
    expect(global.fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(restoreButton());
    expect(global.fetch).toHaveBeenCalledTimes(1);
    finish({ ok: true, status: 200, json: async () => ({ data: { list_name: "Qualified" } }) } as Response);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
