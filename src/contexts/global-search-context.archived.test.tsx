// @vitest-environment jsdom
//
// The dashboard layout turns the education-only "archived lookup" on; the provider must hand that flag to the Global Search
// palette — and default it OFF, so every other industry is untouched.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// next/dynamic would lazy-load the real palette; stand in a probe that shows the props it received.
vi.mock("next/dynamic", () => ({
  default: () =>
    function PaletteProbe(props: { archivedLookupEnabled?: boolean; currentUserId: string }) {
      return <div data-testid="palette" data-archived={String(props.archivedLookupEnabled)} data-user={props.currentUserId} />;
    },
}));

import { GlobalSearchProvider } from "./global-search-context";

afterEach(cleanup);

const renderProvider = (archivedLookupEnabled?: boolean) =>
  render(
    <GlobalSearchProvider navIndex={[]} currentUserId="u-1" {...(archivedLookupEnabled === undefined ? {} : { archivedLookupEnabled })}>
      <span>page</span>
    </GlobalSearchProvider>,
  );

describe("GlobalSearchProvider — archived lookup flag", () => {
  it("passes the flag through to the palette when the layout turns it on", () => {
    renderProvider(true);
    expect(screen.getByTestId("palette")).toHaveAttribute("data-archived", "true");
  });
  it("passes false through when the layout turns it off", () => {
    renderProvider(false);
    expect(screen.getByTestId("palette")).toHaveAttribute("data-archived", "false");
  });
  it("defaults to OFF when the layout says nothing (every other caller is unchanged)", () => {
    renderProvider();
    expect(screen.getByTestId("palette")).toHaveAttribute("data-archived", "false");
  });
  it("still passes the other props the palette needs", () => {
    renderProvider(true);
    expect(screen.getByTestId("palette")).toHaveAttribute("data-user", "u-1");
  });
});
