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
    fireEvent.click(screen.getByLabelText("Chat on")); // not the office hours switch

    await screen.findByText("Chat off");
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ enabled: false });
  });

  it("accepts a readable custom colour and sends it when saving", async () => {
    const fetchMock = mockFetch([{ body: { data: connected } }, { body: { data: connected } }]);
    render(<WebsiteChatCard />);

    fireEvent.change(await screen.findByLabelText("Custom colour"), { target: { value: "#001353" } });
    expect(screen.getByText(/Readable: white text on this colour is 17\.2:1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).color).toBe("#001353");
  });

  it("warns about a colour too light for white text and never sends it", async () => {
    const fetchMock = mockFetch([{ body: { data: connected } }, { body: { data: connected } }]);
    render(<WebsiteChatCard />);

    fireEvent.change(await screen.findByLabelText("Custom colour"), { target: { value: "#FDED22" } });
    expect(screen.getByText(/Too light for white text \(1\.2:1, needs 4\.5:1\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).color).toBe(DEFAULT_WEBSITE_CHAT_SETTINGS.color);
  });

  it("uploads a logo and shows it, without losing what was typed but not saved", async () => {
    const withLogo = { ...connected, logoUrl: "https://chat.example.com/logo.png" };
    const fetchMock = mockFetch([{ body: { data: { ...connected, logoUrl: null } } }, { body: { data: withLogo } }]);
    render(<WebsiteChatCard />);

    const title = (await screen.findByLabelText("Title")) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Chat with Admizz" } });
    fireEvent.change(screen.getByLabelText("Upload a logo"), { target: { files: [new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" })] } });

    expect(await screen.findByAltText("Chat logo")).toHaveAttribute("src", "https://chat.example.com/logo.png");
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/inbox/website-chat/logo");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(((init.body as FormData).get("logo") as File).name).toBe("logo.png");
    expect(title.value).toBe("Chat with Admizz"); // the unsaved edit is still there
    expect(toast.success).toHaveBeenCalledWith("Logo saved");
  });

  it("refuses a logo over 1 MB before sending anything", async () => {
    const fetchMock = mockFetch([{ body: { data: connected } }]);
    render(<WebsiteChatCard />);

    const big = new File([new Uint8Array(1024 * 1024 + 1)], "big.png", { type: "image/png" });
    fireEvent.change(await screen.findByLabelText("Upload a logo"), { target: { files: [big] } });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("too big"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("removes the logo", async () => {
    const fetchMock = mockFetch([
      { body: { data: { ...connected, logoUrl: "https://chat.example.com/logo.png" } } },
      { body: { data: { ...connected, logoUrl: null } } },
    ]);
    render(<WebsiteChatCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.queryByAltText("Chat logo")).not.toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/inbox/website-chat/logo");
    expect(init.method).toBe("DELETE");
  });

  it("shows the office hours only when turned on, says what off means, and sends them when saving", async () => {
    const fetchMock = mockFetch([{ body: { data: connected } }, { body: { data: connected } }]);
    render(<WebsiteChatCard />);

    expect(await screen.findByText(/always shows the team as online/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Opens")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/outside office hours/));
    fireEvent.change(await screen.findByLabelText("Opens"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Sun" }));

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    expect(sent.officeHours).toMatchObject({ enabled: true, open: "10:00", close: "18:00" });
    expect(sent.officeHours.days).toEqual([1, 2, 3, 4, 5, 0]); // Sunday added to the default Mon to Fri
  });

  it("a hidden field can no longer be marked required", async () => {
    mockFetch([{ body: { data: connected } }]);
    render(<WebsiteChatCard />);

    await screen.findByText(/SNIPPET/);
    fireEvent.click(screen.getByLabelText("Show Name"));
    expect(screen.getByLabelText("Name required")).toBeDisabled();
  });
});
