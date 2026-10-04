// @vitest-environment jsdom
/* eslint-disable @next/next/no-html-link-for-pages -- the test drives raw <a> clicks on purpose */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

let mockPathname = "/leads";
let mockSearch = "";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import { RouteProgress } from "./route-progress";

// One stable tree, so `rerender(tree())` updates the same RouteProgress instance (a different
// tree would remount it and drop its state).
const tree = () => (
  <div>
    <a href="/pipeline">Pipeline</a>
    <a href="/leads">Leads (current page)</a>
    <a href="https://other.example.com/x">External</a>
    <a href="/contacts" target="_blank">New tab</a>
    <a href="/archived" data-no-progress>Opt out</a>
    <RouteProgress />
  </div>
);
const mount = () => render(tree());

const bar = () => screen.queryByRole("progressbar");

beforeEach(() => {
  mockPathname = "/leads";
  mockSearch = "";
  window.history.pushState({}, "", "/leads"); // the page the user is "on"
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RouteProgress", () => {
  it("renders nothing until a navigation starts", () => {
    mount();
    expect(bar()).toBeNull();
  });

  it("starts on an internal link click, shows the badge only after the delay, and climbs but never past 90", () => {
    mount();
    fireEvent.click(screen.getByText("Pipeline"));
    expect(bar()).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).toBeNull(); // no flash for instant navs

    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(6000); });
    const now = Number(bar()!.getAttribute("aria-valuenow"));
    expect(now).toBeGreaterThan(50);
    expect(now).toBeLessThanOrEqual(90);
    expect(screen.getByText(`${now}%`)).toBeInTheDocument();
  });

  it("completes to 100% when the route changes, then disappears", () => {
    const { rerender } = mount();
    fireEvent.click(screen.getByText("Pipeline"));
    act(() => { vi.advanceTimersByTime(500); });

    mockPathname = "/pipeline";
    rerender(tree());
    expect(bar()!.getAttribute("aria-valuenow")).toBe("100");

    act(() => { vi.advanceTimersByTime(400); });
    expect(bar()).toBeNull();
  });

  it("completes when only the query string changes", () => {
    const { rerender } = mount();
    fireEvent.click(screen.getByText("Pipeline"));
    mockSearch = "stage=won";
    rerender(tree());
    expect(bar()!.getAttribute("aria-valuenow")).toBe("100");
  });

  it("does not start for the current page, external links, new-tab links, opted-out links, or modified clicks", () => {
    mount();
    fireEvent.click(screen.getByText("Leads (current page)"));
    fireEvent.click(screen.getByText("External"));
    fireEvent.click(screen.getByText("New tab"));
    fireEvent.click(screen.getByText("Opt out"));
    fireEvent.click(screen.getByText("Pipeline"), { ctrlKey: true });
    fireEvent.click(screen.getByText("Pipeline"), { metaKey: true });
    expect(bar()).toBeNull();
  });

  it("starts on back/forward (popstate)", () => {
    mount();
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(bar()).toBeInTheDocument();
  });

  it("gives up after the safety timeout if the URL never changes, instead of sticking", () => {
    mount();
    fireEvent.click(screen.getByText("Pipeline"));
    expect(bar()).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(10_500); });
    expect(bar()).toBeNull();
  });

  it("with reduced motion, shows 90% immediately without trickling", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    mount();
    fireEvent.click(screen.getByText("Pipeline"));
    expect(bar()!.getAttribute("aria-valuenow")).toBe("90");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(bar()!.getAttribute("aria-valuenow")).toBe("90");
  });
});
