// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BottomSheet } from "./bottom-sheet";

afterEach(() => cleanup());

function renderSheet(onOpenChange = vi.fn()) {
  render(
    <BottomSheet open onOpenChange={onOpenChange} title="Move to stage" subtitle="Sita Gurung · UEL" testId="sheet">
      <div role="listbox">
        <button type="button" role="option" aria-selected={false}>
          Applied
        </button>
      </div>
    </BottomSheet>,
  );
  return onOpenChange;
}

describe("BottomSheet", () => {
  it("renders the title, subtitle, grab handle and content, with 44px row overrides on the body", () => {
    renderSheet();
    const sheet = screen.getByTestId("sheet");
    expect(sheet).toHaveTextContent("Move to stage");
    expect(sheet).toHaveTextContent("Sita Gurung · UEL");
    expect(sheet.className).toContain("rounded-t-[16px]");
    expect(sheet.className).toContain("max-h-[78dvh]");
    const body = screen.getByRole("option").closest("div[class*='overflow-y-auto']")!;
    expect(body.className).toContain("[&_[role=option]]:h-11");
  });

  it("closes on ✕", () => {
    const onOpenChange = renderSheet();
    fireEvent.click(screen.getByTestId("sheet-close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on a swipe down past 80px, springs back on a short one", () => {
    const onOpenChange = renderSheet();
    const grab = screen.getByTestId("sheet-grab");
    fireEvent.pointerDown(grab, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grab, { clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(grab, { clientY: 140, pointerId: 1 });
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.pointerDown(grab, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grab, { clientY: 220, pointerId: 1 });
    fireEvent.pointerUp(grab, { clientY: 220, pointerId: 1 });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
