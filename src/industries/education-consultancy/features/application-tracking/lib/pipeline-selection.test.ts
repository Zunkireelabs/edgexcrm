import { describe, it, expect } from "vitest";
import { resolvePipelineSelection, withPipelineParam } from "./pipeline-selection";
import { IMPLICIT_PIPELINE } from "./board-placement";

const pipelines = [
  { id: "pA", is_default: false, position: 1 },
  { id: "pD", is_default: true, position: 0 },
];

describe("pipeline selection", () => {
  it("reads ?pipeline= on load", () => {
    expect(resolvePipelineSelection("pA", pipelines)).toBe("pA");
  });
  it("unknown id falls back to Default", () => {
    expect(resolvePipelineSelection("nope", pipelines)).toBe("pD");
  });
  it("missing param falls back to Default", () => {
    expect(resolvePipelineSelection(null, pipelines)).toBe("pD");
  });
  it("no pipelines -> implicit board", () => {
    expect(resolvePipelineSelection("pA", [])).toBe(IMPLICIT_PIPELINE);
  });
  it("writes ?pipeline= on change and keeps other params", () => {
    expect(withPipelineParam("", "pA")).toBe("pipeline=pA");
    expect(withPipelineParam("foo=1&pipeline=pD", "pA")).toBe("foo=1&pipeline=pA");
  });
});
