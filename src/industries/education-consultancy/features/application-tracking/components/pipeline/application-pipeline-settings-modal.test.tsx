// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ApplicationPipelineSettingsModal } from "./application-pipeline-settings-modal";
import type { ApplicationPipelineWithCounts, ApplicationStage } from "@/types/database";

const stage = (id: string, name: string, position: number, o: Partial<ApplicationStage> = {}): ApplicationStage =>
  ({ id, name, position, tenant_id: "t", pipeline_id: "p1", slug: id, color: "#3b82f6", is_default: false, is_terminal: false, terminal_type: null, created_at: "", updated_at: "", ...o }) as ApplicationStage;
const stages = [stage("s1", "Applied", 0, { is_default: true }), stage("s2", "Offer", 1), stage("s3", "Enrolled", 2, { is_terminal: true, terminal_type: "won" })];
const pipeline = { id: "p1", name: "Default", is_default: true, stage_count: 3, application_count: 0 } as ApplicationPipelineWithCounts;

let calls: { method: string; url: string; body?: string }[];
beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url, body: init?.body as string | undefined });
      const isGet = !init?.method;
      return { ok: true, status: 200, json: async () => (isGet ? { data: { id: "p1", name: "Default", is_default: true, stages } } : { data: { id: "NEW1" } }) };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const writes = () => calls.filter((c) => c.method !== "GET");

function renderModal(onClose = vi.fn()) {
  render(<ApplicationPipelineSettingsModal open onClose={onClose} pipeline={pipeline} stages={stages} stageAppCounts={{ s1: 3 }} />);
  return onClose;
}

describe("ApplicationPipelineSettingsModal (buffered edits)", () => {
  it("opens with the stages from props on first paint (no loading state)", () => {
    renderModal();
    expect(screen.getAllByTestId("settings-stage-row")).toHaveLength(3);
  });

  it("edits make no API writes; Cancel with edits asks to discard, and Discard closes with zero writes", async () => {
    const onClose = renderModal();
    fireEvent.change(screen.getAllByLabelText("Stage name")[1], { target: { value: "Offer made" } });
    fireEvent.blur(screen.getAllByLabelText("Stage name")[1]);
    fireEvent.click(screen.getByText("Cancel"));
    expect(await screen.findByText("Discard changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Discard"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([]);
  });

  it("Cancel with no edits closes straight away", () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Save applies the buffered rename in one PATCH, then closes", async () => {
    const onClose = renderModal();
    const input = screen.getAllByLabelText("Stage name")[1];
    fireEvent.change(input, { target: { value: "Offer made" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes()).toEqual([{ method: "PATCH", url: "/api/v1/application-pipelines/p1/stages/s2", body: JSON.stringify({ name: "Offer made" }) }]);
  });

  it("deleting a stage with applications is blocked locally with no call", async () => {
    renderModal();
    fireEvent.click(screen.getAllByLabelText("Stage options")[0]);
    fireEvent.click(screen.getByText("Delete stage…"));
    expect(await screen.findByText(/Move the 3 applications out of Applied first/)).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it("a new stage added then deleted again makes no calls", async () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByText("Add stage"));
    fireEvent.change(screen.getByPlaceholderText("New stage name"), { target: { value: "Temp" } });
    fireEvent.click(screen.getByText("Add"));
    const rows = screen.getAllByTestId("settings-stage-row"); // Active (Applied, Offer, Temp) then Finished (Enrolled)
    expect(rows).toHaveLength(4);
    expect(rows[2]).toHaveTextContent("0 apps");
    fireEvent.click(rows[2].querySelector("button[aria-label='Stage options']")!);
    fireEvent.click(screen.getByText("Delete stage…"));
    fireEvent.click(screen.getByText("Delete stage"));
    expect(screen.getAllByTestId("settings-stage-row")).toHaveLength(3);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1); // not dirty -> no discard prompt
    expect(writes()).toEqual([]);
  });
});
