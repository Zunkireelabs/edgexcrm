// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { toast } from "sonner";
import { WebsiteChatCard } from "./website-chat-card";
import { DEFAULT_WEBSITE_CHAT_SETTINGS } from "@/lib/inbox/website-chat/settings";

const connected = {
  connected: true,
  enabled: true,
  settings: { ...DEFAULT_WEBSITE_CHAT_SETTINGS, websiteHost: "admizzeducation.com" },
  snippet: "<script>SNIPPET</script>",
};
const notConnected = { connected: false, enabled: false, settings: null, snippet: null };

function mockFetch(handlers: Array<{ status?: number; body: unknown }>) {
  const fn = vi.fn(async () => {
    const next = handlers.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WebsiteChatCard", () => {
  it("shows nothing when website chat is not available on this server", async () => {
    const fetchMock = mockFetch([{ status: 404, body: {} }]);
    const { container } = render(<WebsiteChatCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Connect before it is set up, and sends the website address", async () => {
    const fetchMock = mockFetch([{ body: { data: notConnected } }, { status: 201, body: { data: connected } }]);
    render(<WebsiteChatCard />);

    const input = await screen.findByLabelText("Your website address");
    const button = screen.getByRole("button", { name: "Connect website chat" });
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: "admizzeducation.com" } });
    fireEvent.click(button);

    await screen.findByText("Put it on your website");
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/inbox/website-chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ websiteHost: "admizzeducation.com" });
  });

  it("shows the real reason, not just \"Validation failed\", when the server rejects the address", async () => {
    mockFetch([
      { body: { data: notConnected } },
      {
        status: 422,
        body: { error: { code: "VALIDATION_ERROR", message: "Validation failed", details: { websiteHost: ["Enter your website address, for example example.com"] } } },
      },
    ]);
    render(<WebsiteChatCard />);

    fireEvent.change(await screen.findByLabelText("Your website address"), { target: { value: "localhost:3001" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect website chat" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Enter your website address, for example example.com"));
  });

  it("shows the code and lets the admin switch chat off", async () => {
    const fetchMock = mockFetch([{ body: { data: connected } }, { body: { data: { ...connected, enabled: false } } }]);
    render(<WebsiteChatCard />);

    expect(await screen.findByText(/SNIPPET/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));

    await screen.findByText("Chat off");
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ enabled: false });
  });

  it("a hidden field can no longer be marked required", async () => {
    mockFetch([{ body: { data: connected } }]);
    render(<WebsiteChatCard />);

    await screen.findByText(/SNIPPET/);
    fireEvent.click(screen.getByLabelText("Show Name"));
    expect(screen.getByLabelText("Name required")).toBeDisabled();
  });
});
