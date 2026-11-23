// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { OrcaBrief } from "./orca-brief";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const json = (data: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve({ data }) });
const insight = (over = {}) => ({ summary: "Wants nursing in Australia.", generated_at: new Date().toISOString(), isExpired: false, score: 91, ...over });
let fetchMock: ReturnType<typeof vi.fn>;
const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });

describe("OrcaBrief never generates without a click", () => {
  it("no cache: mounting makes zero POST calls, even after time passes; shows 'No brief yet' + Generate", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockImplementation(() => json({ insights: null, cached: false }));
    render(<OrcaBrief leadId="L1" enabled />);
    expect(await screen.findByText(/No brief yet/)).toBeTruthy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(posts()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Generate" })).toBeTruthy();
  });

  it("expired cache: same, no POST", async () => {
    fetchMock.mockImplementation(() => json({ insights: insight({ isExpired: true }), cached: true }));
    render(<OrcaBrief leadId="L1" enabled />);
    expect(await screen.findByText(/No brief yet/)).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it("valid cache: shows the summary, never the score, and makes no POST", async () => {
    fetchMock.mockImplementation(() => json({ insights: insight(), cached: true }));
    const { container } = render(<OrcaBrief leadId="L1" enabled />);
    expect(await screen.findByText("Wants nursing in Australia.")).toBeTruthy();
    expect(container.textContent).not.toContain("91");
    expect(posts()).toHaveLength(0);
  });

  it("only a click POSTs: Generate = plain POST, Refresh = POST ?force=true", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json({ insights: insight({ summary: "Fresh." }) }) : json({ insights: null }));
    render(<OrcaBrief leadId="L1" enabled />);
    fireEvent.click(await screen.findByRole("button", { name: "Generate" }));
    expect(await screen.findByText("Fresh.")).toBeTruthy();
    expect(posts().map(([u]) => u)).toEqual(["/api/v1/leads/L1/insights"]);
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1][0]).toBe("/api/v1/leads/L1/insights?force=true");
  });

  it("AI off: renders nothing and calls nothing", () => {
    const { container } = render(<OrcaBrief leadId="L1" enabled={false} />);
    expect(container.firstChild).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
