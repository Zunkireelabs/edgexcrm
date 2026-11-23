// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Lead } from "@/types/database";

vi.mock("@/components/dashboard/lead-preview-panel", () => ({
  LeadPreviewPanel: () => <div data-testid="legacy-panel" />,
}));

import { LeadPreviewSlot } from "./preview-slot";

const lead = { id: "l1", first_name: "A", last_name: "B" } as Lead;
const base = { onClose: () => {}, stages: [], memberMap: {}, memberNames: {} };

describe("LeadPreviewSlot", () => {
  afterEach(cleanup);
  it("non-education tenants still get the old LeadPreviewPanel in its 380px wrapper", () => {
    const { container } = render(<LeadPreviewSlot {...base} education={false} previewLead={lead} educationLead={lead} renderEducation={() => <div data-testid="record-preview" />} />);
    expect(screen.getByTestId("legacy-panel")).toBeTruthy();
    expect(screen.queryByTestId("record-preview")).toBeNull();
    expect(container.querySelector(".w-\\[380px\\]")).not.toBeNull();
  });

  it("education tenants get the record preview and no legacy panel or wrapper", () => {
    const { container } = render(<LeadPreviewSlot {...base} education previewLead={lead} educationLead={lead} renderEducation={() => <div data-testid="record-preview" />} />);
    expect(screen.getByTestId("record-preview")).toBeTruthy();
    expect(screen.queryByTestId("legacy-panel")).toBeNull();
    expect(container.querySelector(".w-\\[380px\\]")).toBeNull();
  });

  it("closed: nothing for education, empty collapsed wrapper for the others", () => {
    const edu = render(<LeadPreviewSlot {...base} education previewLead={null} educationLead={null} renderEducation={() => <div />} />);
    expect(edu.container.innerHTML).toBe("");
    const other = render(<LeadPreviewSlot {...base} education={false} previewLead={null} educationLead={null} renderEducation={() => <div />} />);
    expect(other.container.querySelector(".w-0")).not.toBeNull();
  });
});
