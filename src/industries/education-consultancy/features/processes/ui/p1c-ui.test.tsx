// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StepBar } from "./step-bar";
import type { StepView } from "../server/load-processes";

const step = (value: number | null): StepView => ({
  key: "k", title: "t", who: [], text: "", drives: [], target: { metric: "m", op: ">=", value: 80, unit: "percent" },
  metricLabel: "m", value, detail: "", fraction: null, owners: "", kind: "step", status: "red",
});

describe("SegmentedControl count gap", () => {
  it("the segmented variant's count has a left gap", () => {
    render(<SegmentedControl aria-label="x" value="a" onValueChange={() => {}} items={[{ value: "a", label: "Versions", count: 1 }]} />);
    expect(screen.getByText("1").className).toContain("ml-1.5");
  });
});

describe("StepBar", () => {
  it("draws a visible stub at 0%", () => {
    render(<StepBar step={step(0)} />);
    expect(screen.getByTestId("step-bar-fill").style.minWidth).toBe("4px");
  });
  it("draws nothing without a value", () => {
    const { container } = render(<StepBar step={step(null)} />);
    expect(container.firstChild).toBeNull();
  });
});
