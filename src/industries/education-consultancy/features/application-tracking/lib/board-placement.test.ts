import { describe, it, expect } from "vitest";
import { resolveBoardPlacement, IMPLICIT_PIPELINE } from "./board-placement";

const pipelines = [
  { id: "pD", is_default: true, position: 0 },
  { id: "pA", is_default: false, position: 1 },
];
const stages = [
  { id: "d1", pipeline_id: "pD", is_default: true, position: 0 },
  { id: "d2", pipeline_id: "pD", is_default: false, position: 1 },
  { id: "a1", pipeline_id: "pA", is_default: false, position: 0 },
  { id: "a2", pipeline_id: "pA", is_default: true, position: 1 },
];

describe("resolveBoardPlacement", () => {
  it("places a null-pipeline app under Default and counts it", () => {
    const r = resolveBoardPlacement([{ id: "1", stage_id: "d2", pipeline_id: null }], stages, pipelines);
    expect(r.placements.get("1")).toEqual({ pipelineId: "pD", stageId: "d2" });
    expect(r.noPipelineCount).toBe(1);
  });

  it("follows the stage's pipeline over a conflicting app.pipeline_id", () => {
    const r = resolveBoardPlacement([{ id: "1", stage_id: "a1", pipeline_id: "pD" }], stages, pipelines);
    expect(r.placements.get("1")).toEqual({ pipelineId: "pA", stageId: "a1" });
    expect(r.noPipelineCount).toBe(0);
  });

  it("unknown stage falls back to app.pipeline_id and that pipeline's Start stage", () => {
    const r = resolveBoardPlacement([{ id: "1", stage_id: "gone", pipeline_id: "pA" }], stages, pipelines);
    expect(r.placements.get("1")).toEqual({ pipelineId: "pA", stageId: "a2" });
  });

  it("unknown stage and null pipeline lands on Default's Start stage", () => {
    const r = resolveBoardPlacement([{ id: "1", stage_id: "gone", pipeline_id: null }], stages, pipelines);
    expect(r.placements.get("1")).toEqual({ pipelineId: "pD", stageId: "d1" });
  });

  it("Start stage falls back to lowest position when none is_default", () => {
    const st = stages.map((s) => ({ ...s, is_default: false }));
    const r = resolveBoardPlacement([{ id: "1", stage_id: "gone", pipeline_id: "pA" }], st, pipelines);
    expect(r.placements.get("1")?.stageId).toBe("a1");
  });

  it("never drops an app: per-pipeline counts sum to apps.length", () => {
    const apps = [
      { id: "1", stage_id: "d1", pipeline_id: "pD" },
      { id: "2", stage_id: "a2", pipeline_id: null },
      { id: "3", stage_id: "gone", pipeline_id: null },
      { id: "4", stage_id: "gone", pipeline_id: "ghost" },
      { id: "5", stage_id: "d1", pipeline_id: "pA" },
    ];
    const r = resolveBoardPlacement(apps, stages, pipelines);
    const sum = [...r.countByPipeline.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBe(apps.length);
    expect(r.placements.size).toBe(apps.length);
    expect(r.noPipelineCount).toBe(1); // app 2 has a null pipeline but its stage puts it in pA
  });

  it("no pipelines at all: one implicit board holding everything", () => {
    const st = stages.map((s) => ({ ...s, pipeline_id: null }));
    const apps = [
      { id: "1", stage_id: "d1", pipeline_id: null },
      { id: "2", stage_id: "gone", pipeline_id: null },
    ];
    const r = resolveBoardPlacement(apps, st, []);
    expect(r.countByPipeline.get(IMPLICIT_PIPELINE)).toBe(2);
    expect(r.placements.get("2")?.stageId).toBe("d1");
    expect(r.noPipelineCount).toBe(0);
  });
});

import { appsOnPipeline } from "./board-placement";

describe("header count = rendered count", () => {
  it("appsOnPipeline returns exactly the apps placed on that pipeline (null-pipeline apps included on Default)", () => {
    const apps = [
      { id: "1", stage_id: "d1", pipeline_id: "pD" },
      { id: "2", stage_id: "d2", pipeline_id: null },
      { id: "3", stage_id: "a1", pipeline_id: "pA" },
    ];
    const r = resolveBoardPlacement(apps, stages, pipelines);
    expect(appsOnPipeline(apps, r.placements, "pD").map((a) => a.id)).toEqual(["1", "2"]);
    expect(appsOnPipeline(apps, r.placements, "pD").length).toBe(r.countByPipeline.get("pD"));
    expect(appsOnPipeline(apps, r.placements, "pA").length).toBe(r.countByPipeline.get("pA"));
  });
});
