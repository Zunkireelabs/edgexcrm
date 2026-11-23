// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DraftPanel } from "./draft-panel";
import type { DoNextItem } from "../lib/types";

afterEach(cleanup);

const ITEM = { key: "deadline_docs:a1", kind: "deadline_docs", tier: "today", leadId: "L1", title: "Sita Gurung", why: "", chip: { text: "Closes in 6 days", tone: "warn" }, tone: "warn", primaryAction: { type: "open", href: "/applications/a1", label: "Open" }, sortKey: { group: 0, at: 0 }, evidenceHref: "/leads/L1" } as unknown as DoNextItem;
const PAYLOAD = (o: Record<string, unknown> = {}) => ({
  ai: true, leadId: "L1", leadName: "Sita Gurung", channels: ["whatsapp"], channel: "whatsapp", phone: "+9779841234567", email: null, recordsRead: ["Sita's record", "your last 2 notes"],
  chips: { application: "Deakin · Master of IT", deadline: "2026-11-15", missing: ["Bank statement"] },
  draft: { id: "d1", text: "Hi Sita, please send your bank statement.", subject: null, why: "The deadline is in 6 days.", followUp: { title: "Check for the statement", dueDate: "2026-11-12" } }, ...o,
});

let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
function stubFetch(draft: unknown) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    calls.push({ url, body });
    if (url === "/api/v1/home/draft") return { ok: true, status: 200, json: async () => ({ data: draft }) };
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  }));
}
const openSpy = vi.fn();
beforeEach(() => { vi.stubGlobal("open", openSpy); openSpy.mockClear(); });

describe("DraftPanel", () => {
  it("shows Orca's draft with 'Why this message' naming exactly the records read, and the follow-up task ticked", async () => {
    stubFetch(PAYLOAD());
    render(<DraftPanel key={ITEM.key} item={ITEM} onClose={() => {}} onSent={() => {}} />);
    await screen.findByText("Hi Sita, please send your bank statement.");
    expect(screen.getByText(/Why this message:/).closest("p")?.textContent).toContain("Orca read Sita's record, your last 2 notes. Nothing else.");
    const box = screen.getByLabelText(/Also add a task for me/) as HTMLInputElement | null;
    expect(box?.checked).toBe(true);
    expect(screen.queryByText("SMS")).toBeNull();
  });
  it("no phone and no Gmail: Copy only, no send button, no channel tabs", async () => {
    stubFetch(PAYLOAD({ channels: [], channel: null, phone: null, draft: null }));
    render(<DraftPanel key={ITEM.key} item={ITEM} onClose={() => {}} onSent={() => {}} />);
    await screen.findByText(/nothing to send from here/);
    expect(screen.queryByText("Open in WhatsApp")).toBeNull();
    expect(screen.queryByText("Send email")).toBeNull();
    expect(screen.getByText("Copy")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Channel" })).toBeNull();
  });
  it("Open in WhatsApp opens wa.me and asks 'Did you send it?'; No writes nothing to the timeline", async () => {
    stubFetch(PAYLOAD());
    const onSent = vi.fn();
    render(<DraftPanel key={ITEM.key} item={ITEM} onClose={() => {}} onSent={onSent} />);
    await screen.findByText("Hi Sita, please send your bank statement.");
    fireEvent.click(screen.getByText("Open in WhatsApp"));
    await screen.findByText("Did you send it?");
    expect(openSpy).toHaveBeenCalledWith("https://wa.me/9779841234567?text=Hi%20Sita%2C%20please%20send%20your%20bank%20statement.", "_blank", "noopener");
    fireEvent.click(screen.getByText("No"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/v1/home/draft-resolve")).toBe(true));
    const resolves = calls.filter((c) => c.url === "/api/v1/home/draft-resolve");
    expect(resolves.map((c) => c.body.action)).toEqual(["opened"]);
    expect(calls.some((c) => c.url === "/api/v1/my-tasks")).toBe(false); // no task on "No"
    expect(onSent).not.toHaveBeenCalled();
  });
  it("Yes logs it as sent (with the final text) and creates the follow-up task", async () => {
    stubFetch(PAYLOAD());
    const onSent = vi.fn();
    render(<DraftPanel key={ITEM.key} item={ITEM} onClose={() => {}} onSent={onSent} />);
    await screen.findByText("Hi Sita, please send your bank statement.");
    fireEvent.click(screen.getByText("Open in WhatsApp"));
    fireEvent.click(await screen.findByText("Yes, I sent it"));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(calls.find((c) => c.url === "/api/v1/home/draft-resolve" && c.body.action === "sent")?.body).toMatchObject({ draftId: "d1", channel: "whatsapp", finalText: "Hi Sita, please send your bank statement." });
    expect(calls.find((c) => c.url === "/api/v1/my-tasks")?.body).toEqual({ title: "Check for the statement", due_date: "2026-11-12", lead_id: "L1" });
  });
  it("an unticked follow-up creates no task", async () => {
    stubFetch(PAYLOAD());
    const onSent = vi.fn();
    render(<DraftPanel key={ITEM.key} item={ITEM} onClose={() => {}} onSent={onSent} />);
    await screen.findByText("Hi Sita, please send your bank statement.");
    fireEvent.click(screen.getByLabelText(/Also add a task for me/));
    fireEvent.click(screen.getByText("Open in WhatsApp"));
    fireEvent.click(await screen.findByText("Yes, I sent it"));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(calls.some((c) => c.url === "/api/v1/my-tasks")).toBe(false);
  });
  it("closing without sending records 'discarded'", async () => {
    stubFetch(PAYLOAD());
    const onClose = vi.fn();
    render(<DraftPanel key={ITEM.key} item={ITEM} onClose={onClose} onSent={() => {}} />);
    await screen.findByText("Hi Sita, please send your bank statement.");
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(calls.find((c) => c.url === "/api/v1/home/draft-resolve")?.body).toMatchObject({ draftId: "d1", action: "discarded" });
  });
  it("a failed draft says so and leaves a box to write your own", async () => {
    stubFetch(PAYLOAD({ draft: null }));
    render(<DraftPanel key={ITEM.key} item={ITEM} onClose={() => {}} onSent={() => {}} />);
    await screen.findByText("Write your own");
    expect(screen.getByLabelText("Message")).toBeTruthy();
  });
});
