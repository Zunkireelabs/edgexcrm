// @vitest-environment jsdom
//
// The "Apply bug" postmortem (ADVANCED-FILTERS-BRIEF Phase 3 addendum): serialize.ts
// used `Buffer.from(...).toString("base64url")`, which throws "Unknown encoding:
// base64url" in a real browser bundle (the `buffer` npm shim webpack/Next ship there
// doesn't support the "base64url" encoding string, even though Node's real Buffer
// does). handleApply threw mid-call, before setOpen(false) ever ran — the popover
// never closed and the URL never gained ?f=.
//
// 21 tests in serialize.test.ts (vitest.config.ts: environment "node") never caught
// this because Node's real `Buffer` supports "base64url" natively — the whole bug is
// a Node-vs-browser API gap that a node-environment suite is structurally blind to.
//
// jsdom alone does NOT reproduce the gap (jsdom runs inside Node, so `Buffer` is still
// Node's real implementation) — the meaningful regression guard is deleting `Buffer`
// for the duration of this test, so any reintroduced `Buffer.from(...)` call throws
// a ReferenceError instead of silently passing because the test happened to run in
// an environment where Buffer.from(..., "base64url") works.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encodeFilterTree, decodeFilterTree } from "./serialize";
import type { FilterTree } from "./types";

describe("serialize — browser runtime (no Buffer)", () => {
  const originalBuffer = globalThis.Buffer;

  beforeEach(() => {
    // @ts-expect-error — simulating a real browser bundle, where Buffer either
    // doesn't exist or (the actual production bug) exists but its base64url
    // encoding throws. Deleting it entirely is the stricter guard: any code path
    // that still references Buffer fails loudly here instead of silently passing.
    delete globalThis.Buffer;
  });

  afterEach(() => {
    globalThis.Buffer = originalBuffer;
  });

  it("encodeFilterTree works with no global Buffer (the exact browser-bundle gap)", () => {
    const tree: FilterTree = {
      conjunction: "and",
      conditions: [{ id: "c1", field: "status", op: "is", value: "contacted" }],
    };
    const encoded = encodeFilterTree(tree);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);
    // base64url alphabet only — no +, /, or = padding.
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("round-trips encode -> decode with no global Buffer, including unicode", () => {
    const tree: FilterTree = {
      conjunction: "and",
      conditions: [
        { id: "c1", field: "search", op: "contains", value: "café — 日本語" },
        { id: "c2", field: "assignees", op: "is_any_of", value: ["unassigned", "11111111-1111-4111-8111-111111111111"] },
      ],
    };
    const encoded = encodeFilterTree(tree);
    const decoded = decodeFilterTree(encoded);
    expect(decoded).toEqual({ ok: true, tree });
  });

  it("decodeFilterTree also works with no global Buffer, server-encoded input included", () => {
    // Encode with Buffer present (server-side path), then decode with it absent —
    // both directions of the "browser encodes, server decodes" contract must hold,
    // and the codec must be identical either way (not two divergent implementations).
    globalThis.Buffer = originalBuffer;
    const tree: FilterTree = { conjunction: "and", conditions: [{ id: "c1", field: "status", op: "is", value: "new" }] };
    const encoded = encodeFilterTree(tree);
    // @ts-expect-error — re-simulate the browser gap for the decode half.
    delete globalThis.Buffer;
    expect(decodeFilterTree(encoded)).toEqual({ ok: true, tree });
  });
});
