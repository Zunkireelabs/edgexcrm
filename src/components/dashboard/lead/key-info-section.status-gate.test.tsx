// @vitest-environment jsdom
//
// EDGEX-174: the Status select must be editable for a non-assignee collaborator
// (isEditor, not isAdmin/assignee), while Stage stays read-only for them.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead, PipelineStage } from "@/types/database";
import { KeyInfoSection } from "./key-info-section";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

const lead = {
  id: "lead-1",
  first_name: "Asha",
  last_name: "K",
  pipeline_id: "pipe-1",
  custom_fields: {},
  lead_type: "lead",
} as unknown as Lead;

const stages = [
  { id: "stage-1", pipeline_id: "pipe-1", name: "New", slug: "new", position: 0, is_default: true, color: "#000" },
] as unknown as PipelineStage[];

function renderSection(extra: Record<string, unknown>) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })) as unknown as typeof fetch;
  render(
    <KeyInfoSection
      lead={lead}
      stages={stages}
      stageId="stage-1"
      assignedTo="other-user"
      teamMembers={[]}
      onStageChange={() => {}}
      onAssignmentChange={() => {}}
      industryId="it_agency"
      isAdmin={false}
      {...extra}
    />,
  );
}

describe("KeyInfoSection — Status select gate (EDGEX-174)", () => {
  it("a non-assignee, non-admin collaborator (isEditor) sees Status as editable", () => {
    renderSection({ userId: "collab-user", isAdmin: false, isEditor: true, canEdit: true });
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("a plain own-scope member (not editor) sees Status as read-only", () => {
    renderSection({ userId: "someone-else", isAdmin: false, isEditor: false, canEdit: true });
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("the assignee sees Status as editable", () => {
    renderSection({ userId: "other-user", isAdmin: false, isEditor: true, canEdit: true });
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("admin sees Status as editable regardless of isEditor", () => {
    renderSection({ userId: "admin-user", isAdmin: true, isEditor: false, canEdit: true });
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
