// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CollapsibleGroups, SectionGroup } from "./form-primitives";

afterEach(cleanup);

describe("SectionGroup", () => {
  it("is a plain heading outside <CollapsibleGroups> (e.g. in the dialog)", () => {
    render(
      <SectionGroup title="Personal Information">
        <p>Basic Details</p>
      </SectionGroup>
    );

    expect(screen.getByRole("heading", { name: "Personal Information" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Basic Details")).toBeInTheDocument();
  });

  it("collapses and expands inside <CollapsibleGroups>, starting open", () => {
    render(
      <CollapsibleGroups>
        <SectionGroup title="Personal Information">
          <p>Basic Details</p>
        </SectionGroup>
      </CollapsibleGroups>
    );

    const toggle = screen.getByRole("button", { name: "Personal Information" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Basic Details")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Basic Details")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Basic Details")).toBeInTheDocument();
  });

  it("collapses each group independently, and any group added later is collapsible too", () => {
    render(
      <CollapsibleGroups>
        <SectionGroup title="Personal Information"><p>Personal body</p></SectionGroup>
        <SectionGroup title="Financial Information"><p>Financial body</p></SectionGroup>
        <SectionGroup title="Some Future Section"><p>Future body</p></SectionGroup>
      </CollapsibleGroups>
    );

    fireEvent.click(screen.getByRole("button", { name: "Financial Information" }));

    expect(screen.queryByText("Financial body")).not.toBeInTheDocument();
    expect(screen.getByText("Personal body")).toBeInTheDocument();
    expect(screen.getByText("Future body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Some Future Section" }));
    expect(screen.queryByText("Future body")).not.toBeInTheDocument();
  });
});
