// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { WebsiteChatAiReply } from "./website-chat-ai-reply";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const stub = (put?: { status: number; body: unknown }) => {
  const fn = vi.fn(async () => new Response(JSON.stringify(put?.body ?? {}), { status: put?.status ?? 200 }));
  vi.stubGlobal("fetch", fn);
  return fn;
};
const OFF = { available: true, enabled: false, siteId: "" };

describe("WebsiteChatAiReply", () => {
  it("shows nothing when AI replies are not available (other industry, or server not set up)", () => {
    const fn = stub();
    const { container } = render(<WebsiteChatAiReply initial={{ available: false, enabled: false, siteId: "" }} />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    expect(render(<WebsiteChatAiReply />).container).toBeEmptyDOMElement();
    expect(fn).not.toHaveBeenCalled();     // and it never asks the server anything just by being shown
  });

  it("starts from the saved setting", () => {
    render(<WebsiteChatAiReply initial={{ available: true, enabled: true, siteId: "admizz-edu" }} />);
    expect(screen.getByRole("switch", { name: "AI replies" })).toBeChecked();
    expect(screen.getByLabelText("Admizz AI site ID")).toHaveValue("admizz-edu");
  });

  it("shows the saved setting and saves the switch with the site id", async () => {
    const fn = stub({ status: 200, body: { data: { enabled: true, siteId: "admizz-edu" } } });
    render(<WebsiteChatAiReply initial={OFF} />);
    const input = await screen.findByLabelText("Admizz AI site ID");
    fireEvent.change(input, { target: { value: "admizz-edu" } });
    fireEvent.click(screen.getByRole("switch", { name: "AI replies" }));
    fireEvent.click(screen.getByRole("button", { name: "Save AI replies" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("AI replies saved"));
    const put = (fn.mock.calls as unknown as [string, RequestInit][])[0];
    expect(put[0]).toBe("/api/v1/inbox/website-chat/ai-reply");
    expect(JSON.parse(put[1].body as string)).toEqual({ enabled: true, siteId: "admizz-edu" });
  });

  it("shows the server's reason when it refuses", async () => {
    stub({
      status: 422,
      body: { error: { message: "Validation failed", details: { siteId: ["Enter the Admizz AI site ID to turn AI replies on"] } } },
    });
    render(<WebsiteChatAiReply initial={OFF} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save AI replies" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Enter the Admizz AI site ID to turn AI replies on"));
  });
});
