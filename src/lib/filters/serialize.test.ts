import { describe, it, expect } from "vitest";
import { countActiveConditions, decodeFilterTree, encodeFilterTree, isEmptyTree, MAX_ENCODED_LEN, FILTER_PARAM, VIEW_PARAM } from "./serialize";
import { EMPTY_TREE, type FilterTree } from "./types";

describe("constants", () => {
  it("FILTER_PARAM is 'f' and VIEW_PARAM is 'view'", () => {
    expect(FILTER_PARAM).toBe("f");
    expect(VIEW_PARAM).toBe("view");
  });

  it("MAX_ENCODED_LEN is 4096", () => {
    expect(MAX_ENCODED_LEN).toBe(4096);
  });
});

describe("encodeFilterTree / decodeFilterTree round-trip", () => {
  it("round-trips the empty tree", () => {
    const encoded = encodeFilterTree(EMPTY_TREE);
    const decoded = decodeFilterTree(encoded);
    expect(decoded).toEqual({ ok: true, tree: EMPTY_TREE });
  });

  it("round-trips a tree with one condition", () => {
    const tree: FilterTree = {
      conjunction: "and",
      conditions: [{ id: "c1", field: "status", op: "is", value: "new" }],
    };
    const decoded = decodeFilterTree(encodeFilterTree(tree));
    expect(decoded).toEqual({ ok: true, tree });
  });

  it("round-trips a tree with groups", () => {
    const tree: FilterTree = {
      conjunction: "and",
      conditions: [{ id: "c1", field: "status", op: "is_any_of", value: ["new", "contacted"] }],
      groups: [
        {
          conjunction: "or",
          conditions: [
            { id: "g1", field: "source", op: "is", value: "web" },
            { id: "g2", field: "source", op: "is", value: "referral" },
          ],
        },
      ],
    };
    const decoded = decodeFilterTree(encodeFilterTree(tree));
    expect(decoded).toEqual({ ok: true, tree });
  });

  it("produces a base64url string (no + / = characters)", () => {
    const encoded = encodeFilterTree({
      conjunction: "and",
      conditions: [{ id: "c1", field: "search", op: "contains", value: "a+b/c=d" }],
    });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("is unpadded", () => {
    // Pick a payload whose base64 (padded) would definitely have '=' padding.
    const encoded = encodeFilterTree({ conjunction: "and", conditions: [] });
    expect(encoded.endsWith("=")).toBe(false);
  });
});

describe("decodeFilterTree error handling", () => {
  it("rejects an empty string", () => {
    const result = decodeFilterTree("");
    expect(result.ok).toBe(false);
  });

  it("rejects invalid base64url", () => {
    const result = decodeFilterTree("!!!not-base64!!!");
    expect(result.ok).toBe(false);
  });

  it("rejects base64url that decodes to invalid JSON", () => {
    const encoded = Buffer.from("not json{{{", "utf8").toString("base64url");
    const result = decodeFilterTree(encoded);
    expect(result.ok).toBe(false);
  });

  it("rejects a tree failing zod validation, with per-field errors", () => {
    const encoded = Buffer.from(JSON.stringify({ conjunction: "xor", conditions: [] }), "utf8").toString("base64url");
    const result = decodeFilterTree(encoded);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).length).toBeGreaterThan(0);
    }
  });

  it("rejects an encoded string over MAX_ENCODED_LEN with an actionable message, not a transport error", () => {
    const hugeTree: FilterTree = {
      conjunction: "and",
      conditions: [{ id: "c1", field: "assignees", op: "is_any_of", value: Array.from({ length: 250 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`) }],
    };
    const encoded = encodeFilterTree(hugeTree);
    expect(encoded.length).toBeGreaterThan(MAX_ENCODED_LEN);
    const result = decodeFilterTree(encoded);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.f?.[0]).toMatch(/too large/i);
      expect(result.errors.f?.[0]).toMatch(/view/i);
    }
  });

  it("rejects a tree exceeding the 25-total-conditions cap", () => {
    const conditions = Array.from({ length: 26 }, (_, i) => ({ id: `c${i}`, field: "status", op: "is" as const, value: "new" }));
    const encoded = Buffer.from(JSON.stringify({ conjunction: "and", conditions }), "utf8").toString("base64url");
    const result = decodeFilterTree(encoded);
    expect(result.ok).toBe(false);
  });

  it("rejects is_any_of with an empty value array (422, not a silent no-op)", () => {
    const encoded = Buffer.from(
      JSON.stringify({ conjunction: "and", conditions: [{ id: "c1", field: "assignees", op: "is_any_of", value: [] }] }),
      "utf8"
    ).toString("base64url");
    const result = decodeFilterTree(encoded);
    expect(result.ok).toBe(false);
  });
});

describe("isEmptyTree", () => {
  it("is true for EMPTY_TREE", () => {
    expect(isEmptyTree(EMPTY_TREE)).toBe(true);
  });

  it("is true for a tree with an empty groups array", () => {
    expect(isEmptyTree({ conjunction: "and", conditions: [], groups: [] })).toBe(true);
  });

  it("is false when root has a condition", () => {
    expect(isEmptyTree({ conjunction: "and", conditions: [{ id: "c1", field: "status", op: "is", value: "new" }] })).toBe(false);
  });

  it("is false when only a group has a condition", () => {
    expect(
      isEmptyTree({
        conjunction: "and",
        conditions: [],
        groups: [{ conjunction: "or", conditions: [{ id: "g1", field: "status", op: "is", value: "new" }] }],
      })
    ).toBe(false);
  });
});

describe("countActiveConditions", () => {
  it("is 0 for the empty tree", () => {
    expect(countActiveConditions(EMPTY_TREE)).toBe(0);
  });

  it("counts root conditions", () => {
    expect(
      countActiveConditions({
        conjunction: "and",
        conditions: [
          { id: "c1", field: "status", op: "is", value: "new" },
          { id: "c2", field: "source", op: "is", value: "web" },
        ],
      })
    ).toBe(2);
  });

  it("counts root + all group conditions", () => {
    expect(
      countActiveConditions({
        conjunction: "and",
        conditions: [{ id: "c1", field: "status", op: "is", value: "new" }],
        groups: [
          { conjunction: "or", conditions: [{ id: "g1", field: "source", op: "is", value: "web" }] },
          {
            conjunction: "or",
            conditions: [
              { id: "g2", field: "tag", op: "is", value: "vip" },
              { id: "g3", field: "tag", op: "is", value: "urgent" },
            ],
          },
        ],
      })
    ).toBe(4);
  });
});
