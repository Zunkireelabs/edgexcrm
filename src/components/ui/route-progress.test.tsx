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
import { LoadingPercent, LoadingTitle } from "./loading-percent";
import { getSnapshot, reset } from "@/lib/route-progress-store";

// One stable tree so `rerender(tree())` updates the same instances (a different tree would remount).
const tree = (loadingScreen = false) => (
  <div>
    <a href="/pipeline">Pipeline</a>
    <a href="/leads">Leads (current page)</a>
    <a href="https://other.example.com/x">External</a>
    <a href="/contacts" target="_blank">New tab</a>
    <a href="/archived" data-no-progress>Opt out</a>
    <RouteProgress />
    {loadingScreen && <LoadingTitle label="Pipeline" />}
  </div>
);

// jsdom can't navigate; stop link clicks from logging "Not implemented: navigation" (bubble phase, so
// the component's capture-phase listener still sees every click first).
const stopNavigation = (e: Event) => e.preventDefault();

const state = () => getSnapshot();
const ms = (n: number) => act(() => { vi.advanceTimersByTime(n); });

beforeEach(() => {
  mockPathname = "/leads";
  mockSearch = "";
  window.history.pushState({}, "", "/leads"); // the page the user is "on"
  document.addEventListener("click", stopNavigation);
  vi.useFakeTimers();
  reset();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  document.removeEventListener("click", stopNavigation);
  cleanup();
  act(() => reset());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("RouteProgress (navigation tracker)", () => {
  it("renders nothing until a navigation starts", () => {
    render(tree());
    expect(state().status).toBe("idle");
  });

  it("draws no bar of its own — the in-page chip is the only visible indicator", () => {
    const { container } = render(tree());
    fireEvent.click(screen.getByText("Pipeline"));
    ms(1000);
    expect(state().status).toBe("loading");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(container.querySelector(".fixed")).toBeNull();
  });

  it("starts on a plain internal link click and climbs, never past 90 on its own", () => {
    render(tree());
    fireEvent.click(screen.getByText("Pipeline"));
    expect(state().status).toBe("loading");
    ms(6000);
    const now = state().progress;
    expect(now).toBeGreaterThan(50);
    expect(now).toBeLessThanOrEqual(90);
  });

  it("does not start for the current page, external, new-tab, opted-out links, or modified clicks", () => {
    render(tree());
    fireEvent.click(screen.getByText("Leads (current page)"));
    fireEvent.click(screen.getByText("External"));
    fireEvent.click(screen.getByText("New tab"));
    fireEvent.click(screen.getByText("Opt out"));
    fireEvent.click(screen.getByText("Pipeline"), { ctrlKey: true });
    fireEvent.click(screen.getByText("Pipeline"), { metaKey: true });
    expect(state().status).toBe("idle");
  });

  it("starts on back/forward (popstate)", () => {
    render(tree());
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(state().status).toBe("loading");
  });

  it("with no loading screen, finishes shortly after the route changes", () => {
    const { rerender } = render(tree());
    fireEvent.click(screen.getByText("Pipeline"));
    ms(300);
    mockPathname = "/pipeline";
    rerender(tree());
    ms(150);
    expect(state()).toEqual({ status: "done", progress: 100 });
    ms(400);
    expect(state().status).toBe("idle");
  });

  it("with a loading screen, the URL change does not finish it; the real page replacing the loading screen does", () => {
    const { rerender } = render(tree());
    fireEvent.click(screen.getByText("Pipeline"));
    // destination renders its loading screen; URL changes in the same commit
    mockPathname = "/pipeline";
    rerender(tree(true));
    ms(2000);
    expect(state().status).toBe("loading");
    expect(state().progress).toBeLessThanOrEqual(90);

    // real page arrives -> loading screen unmounts
    rerender(tree(false));
    ms(200);
    expect(state()).toEqual({ status: "done", progress: 100 });
    ms(400);
    expect(state().status).toBe("idle");
  });

  it("gives up after the safety timeout if nothing happens, instead of sticking", () => {
    render(tree());
    fireEvent.click(screen.getByText("Pipeline"));
    ms(10_500);
    expect(state().status).toBe("idle");
  });
});

describe("LoadingPercent / LoadingTitle (in-page chip)", () => {
  it("shows the page's own title and the live percentage", () => {
    const { rerender } = render(tree());
    fireEvent.click(screen.getByText("Pipeline"));
    rerender(tree(true));
    ms(3000);
    expect(screen.getByRole("heading", { name: "Pipeline" })).toBeInTheDocument();
    const now = Math.round(state().progress);
    expect(screen.getByRole("status")).toHaveTextContent(`Loading…${now}%`);
    expect(screen.getByRole("status")).toHaveAccessibleName(`Loading ${now}%`);
  });

  it("a loading screen appearing on its own (programmatic navigation) starts the indicator", () => {
    render(<div><RouteProgress /><LoadingPercent /></div>);
    expect(state().status).toBe("loading");
  });

  it("without a label it keeps a grey title block instead of inventing a title", () => {
    const { container } = render(<LoadingTitle />);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
