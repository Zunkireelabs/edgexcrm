// @vitest-environment jsdom
//
// A file attached to a note can be opened, renamed and removed — but only by the people the server allows:
// anyone who can add notes may rename; only an owner/admin or the uploader may delete (the server's own rule).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));

import { NoteDocumentList, type NoteDocument } from "./note-attachment-ui";

const DOC: NoteDocument = {
  id: "d1", name: "Arden offer", document_type: "conditional_offer", original_filename: "offer.pdf",
  mime_type: "application/pdf", file_size: 2048, uploaded_by: "u-uploader",
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { url: "https://signed.test/file" } }) }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("open", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderList = (over: Partial<Parameters<typeof NoteDocumentList>[0]> = {}) => {
  const onChanged = vi.fn();
  render(<NoteDocumentList documents={[DOC]} currentUserId="u-other" isAdmin={false} canManage onChanged={onChanged} {...over} />);
  return { onChanged };
};

describe("who sees what", () => {
  it("shows rename to people who can add notes, and hides it from everyone else", () => {
    renderList({ canManage: true });
    expect(screen.getByRole("button", { name: "Rename Arden offer" })).toBeInTheDocument();
    cleanup();
    renderList({ canManage: false });
    expect(screen.queryByRole("button", { name: "Rename Arden offer" })).toBeNull();
  });

  it("shows delete to an owner/admin", () => {
    renderList({ isAdmin: true });
    expect(screen.getByRole("button", { name: "Delete Arden offer" })).toBeInTheDocument();
  });

  it("shows delete to the person who uploaded it", () => {
    renderList({ currentUserId: "u-uploader" });
    expect(screen.getByRole("button", { name: "Delete Arden offer" })).toBeInTheDocument();
  });

  it("hides delete from anyone else — the server would refuse it", () => {
    renderList({ currentUserId: "u-other", isAdmin: false });
    expect(screen.queryByRole("button", { name: "Delete Arden offer" })).toBeNull();
  });
});

describe("open", () => {
  it("fetches a signed link and opens it in a new tab", async () => {
    renderList();
    fireEvent.click(screen.getByTitle("offer.pdf · 2 KB"));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://signed.test/file", "_blank", "noopener,noreferrer"));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/documents/d1/download-url");
  });
});

describe("delete", () => {
  it("asks first, then deletes and refreshes", async () => {
    const { onChanged } = renderList({ isAdmin: true });
    fireEvent.click(screen.getByRole("button", { name: "Delete Arden offer" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Arden offer"));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/documents/d1", { method: "DELETE" });
    expect(toastSuccess).toHaveBeenCalledWith("Document deleted");
  });

  it("does nothing when the confirmation is declined", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const { onChanged } = renderList({ isAdmin: true });
    fireEvent.click(screen.getByRole("button", { name: "Delete Arden offer" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows the server's reason and does not refresh when it refuses", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { message: "Forbidden" } }) });
    const { onChanged } = renderList({ isAdmin: true });
    fireEvent.click(screen.getByRole("button", { name: "Delete Arden offer" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Forbidden"));
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("rename", () => {
  const startRename = () => {
    fireEvent.click(screen.getByRole("button", { name: "Rename Arden offer" }));
    return screen.getByLabelText("New name for Arden offer") as HTMLInputElement;
  };

  it("sends the new name and refreshes", async () => {
    const { onChanged } = renderList();
    const input = startRename();
    fireEvent.change(input, { target: { value: "  Arden unconditional offer " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/documents/d1", expect.objectContaining({ method: "PATCH" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "Arden unconditional offer" });
  });

  it("saves on Enter and cancels on Escape", async () => {
    const { onChanged } = renderList();
    let input = startRename();
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("New name for Arden offer")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    input = startRename();
    expect(input.value).toBe("Arden offer"); // the cancelled edit was discarded
    fireEvent.change(input, { target: { value: "New name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("makes no request when the name did not change, and cannot save a blank name", () => {
    renderList();
    const input = startRename();
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(fetchMock).not.toHaveBeenCalled();
    cleanup();
    renderList();
    const again = startRename();
    fireEvent.change(again, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    expect(input).toBeDefined();
  });
});
