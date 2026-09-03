import { describe, it, expect } from "vitest";
import {
  sanitizeSearchTerm,
  buildIlikeOrFilter,
  SEARCH_TERM_MAX_LENGTH,
} from "./search-filter";

describe("sanitizeSearchTerm", () => {
  it("passes ordinary names through unchanged", () => {
    expect(sanitizeSearchTerm("Sarah Chen")).toBe("Sarah Chen");
    expect(sanitizeSearchTerm("bishal.tamang@example.com")).toBe(
      "bishal.tamang@example.com",
    );
  });

  it("keeps apostrophes, hyphens and spaces usable", () => {
    expect(sanitizeSearchTerm("O'Brien")).toBe("O'Brien");
    expect(sanitizeSearchTerm("Jean-Luc")).toBe("Jean-Luc");
    expect(sanitizeSearchTerm("Smith, J")).toBe("Smith, J");
  });

  it("neutralises the double-quote that would end a PostgREST quoted value", () => {
    expect(sanitizeSearchTerm('x"')).toBe('x\\"');
    expect(sanitizeSearchTerm('a"b"c')).toBe('a\\"b\\"c');
  });

  it("escapes backslashes so a trailing backslash can't eat the closing quote", () => {
    expect(sanitizeSearchTerm("foo\\")).toBe("foo\\\\");
    expect(sanitizeSearchTerm("a\\b")).toBe("a\\\\b");
  });

  it("strips the % LIKE wildcard (kills the match-all bypass)", () => {
    expect(sanitizeSearchTerm("%")).toBe("");
    expect(sanitizeSearchTerm("%%%")).toBe("");
    expect(sanitizeSearchTerm("a%b")).toBe("ab");
  });

  it("collapses whitespace and strips control characters", () => {
    expect(sanitizeSearchTerm("a\n\tb")).toBe("a b");
    expect(sanitizeSearchTerm("a\u0000b")).toBe("a b");
    expect(sanitizeSearchTerm("   \n  ")).toBe("");
  });

  it("caps length at SEARCH_TERM_MAX_LENGTH", () => {
    const out = sanitizeSearchTerm("a".repeat(500));
    expect(out).toHaveLength(SEARCH_TERM_MAX_LENGTH);
  });

  it("honours a caller-supplied max length", () => {
    expect(sanitizeSearchTerm("abcdefghij", 4)).toBe("abcd");
  });

  it("caps BEFORE escaping so the cap bounds attacker input, not output", () => {
    // 100 backslashes in -> capped to 100 -> escaped to 200 chars out.
    const out = sanitizeSearchTerm("\\".repeat(200));
    expect(out).toBe("\\".repeat(200)); // 100 escaped pairs
  });
});

describe("buildIlikeOrFilter", () => {
  it("builds a quoted ilike group for every column", () => {
    expect(buildIlikeOrFilter(["first_name", "email"], "chen")).toBe(
      'first_name.ilike."%chen%",email.ilike."%chen%"',
    );
  });

  it("returns null when nothing usable survives (caller skips .or())", () => {
    expect(buildIlikeOrFilter(["first_name"], "%")).toBeNull();
    expect(buildIlikeOrFilter(["first_name"], "   ")).toBeNull();
    expect(buildIlikeOrFilter(["first_name"], "")).toBeNull();
  });

  // --- Phase A regressions: crafted `search` must not become PostgREST syntax ---

  it("REGRESSION: injected extra predicate stays inside the quoted literal", () => {
    // Phase A A1b: `search=zzz,is_final.is.true,first_name.ilike.%` widened the
    // result set to every non-deleted lead in the tenant.
    const out = buildIlikeOrFilter(
      ["first_name", "last_name", "email", "phone"],
      "zzz,is_final.is.true,first_name.ilike.%",
    )!;
    // the comma-separated payload is now one opaque quoted value per column
    expect(out).toBe(
      'first_name.ilike."%zzz,is_final.is.true,first_name.ilike.%",' +
        'last_name.ilike."%zzz,is_final.is.true,first_name.ilike.%",' +
        'email.ilike."%zzz,is_final.is.true,first_name.ilike.%",' +
        'phone.ilike."%zzz,is_final.is.true,first_name.ilike.%"',
    );
    // every top-level segment is a quoted ilike on a searched column; the
    // injected `is_final.is.true` only appears as literal text inside a value
    const segments = out.match(/(?:^|,)([a-z_]+)\.ilike\."(?:[^"\\]|\\.)*"/g)!;
    expect(segments.join("")).toBe(out); // nothing outside a quoted segment
    expect(segments.map((s) => s.replace(/^,/, "").split(".")[0])).toEqual([
      "first_name",
      "last_name",
      "email",
      "phone",
    ]);
  });

  it("REGRESSION: match-all `search=%` produces no filter at all", () => {
    // Phase A: `search=%` returned the whole (tenant-scoped) table.
    expect(
      buildIlikeOrFilter(["first_name", "last_name", "email", "phone"], "%"),
    ).toBeNull();
  });

  it("REGRESSION: quote-breakout attempt cannot escape the value", () => {
    // Attempt to close the quoted value and append a condition.
    const out = buildIlikeOrFilter(
      ["first_name"],
      'x"),tenant_id.eq.evil,first_name.ilike.("x',
    )!;
    expect(out).toBe(
      'first_name.ilike."%x\\"),tenant_id.eq.evil,first_name.ilike.(\\"x%"',
    );
    // every double-quote that isn't one of our two delimiters is escaped
    const unescaped = out.replace(/\\"/g, "");
    expect((unescaped.match(/"/g) || []).length).toBe(2);
  });

  it("REGRESSION: soft-delete probe injection is inert", () => {
    const out = buildIlikeOrFilter(
      ["first_name", "last_name", "email", "phone"],
      "zzz,deleted_at.not.is.null,first_name.ilike.%",
    )!;
    const segments = out.match(/(?:^|,)([a-z_]+)\.ilike\."(?:[^"\\]|\\.)*"/g)!;
    expect(segments.join("")).toBe(out);
    expect(segments.map((s) => s.replace(/^,/, "").split(".")[0])).toEqual([
      "first_name",
      "last_name",
      "email",
      "phone",
    ]);
  });

  it("REGRESSION: an unbounded token is length-capped before it reaches .or()", () => {
    const out = buildIlikeOrFilter(["first_name"], "a".repeat(5000))!;
    expect(out).toBe(`first_name.ilike."%${"a".repeat(SEARCH_TERM_MAX_LENGTH)}%"`);
  });
});
