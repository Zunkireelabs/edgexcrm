import { describe, it, expect } from "vitest";
import { z } from "zod";
import { stripUndefinedKeys, buildRefineToolInput } from "./refine-input";
import type { AgentTool } from "./types";

describe("stripUndefinedKeys", () => {
  it("drops keys whose value is undefined", () => {
    expect(stripUndefinedKeys({ title: "x", assigneeId: undefined, dueDate: undefined, priority: "normal" })).toEqual({
      title: "x",
      priority: "normal",
    });
  });

  it("is a no-op when no key is undefined", () => {
    const input = { title: "x", priority: "normal" };
    expect(stripUndefinedKeys(input)).toEqual(input);
  });

  it("keeps falsy-but-defined values (null, '', 0, false)", () => {
    expect(stripUndefinedKeys({ a: null, b: "", c: 0, d: false, e: undefined })).toEqual({ a: null, b: "", c: 0, d: false });
  });

  it("passes non-objects through untouched", () => {
    expect(stripUndefinedKeys("hello")).toBe("hello");
    expect(stripUndefinedKeys(null)).toBe(null);
    expect(stripUndefinedKeys([1, undefined, 3])).toEqual([1, undefined, 3]);
  });

  it("makes the result survive a JSON round-trip identically (the approval-signature invariant)", () => {
    // JSON.stringify already drops undefined keys — after stripping, the object
    // the SDK signs and the object the browser round-trips are byte-identical.
    const parsed = { title: "Prep Q3 report", dueDate: undefined, assigneeId: undefined, priority: "normal" };
    const refined = stripUndefinedKeys(parsed);
    expect(JSON.parse(JSON.stringify(refined))).toEqual(refined);
  });
});

describe("buildRefineToolInput", () => {
  const tool = (id: string, scope: "read" | "write"): AgentTool =>
    ({ id, scope, description: "", inputSchema: z.object({}), execute: async () => ({}) }) as unknown as AgentTool;

  it("registers a refiner for every write tool and no read tool", () => {
    const map = buildRefineToolInput([tool("create_task", "write"), tool("search_leads", "read"), tool("assign_lead", "write")]);
    expect(Object.keys(map).sort()).toEqual(["assign_lead", "create_task"]);
    expect(map.create_task({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it("returns an empty map when the toolset has no write tools", () => {
    expect(buildRefineToolInput([tool("get_lead", "read")])).toEqual({});
  });
});
