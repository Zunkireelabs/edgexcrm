import { describe, it, expect } from "vitest";
import { and, arrayLiteral, EMPTY_ARRAY_LITERAL, not, or, pgCol, pgLike, pgVal } from "./pgrst";
import { FilterCompileError } from "./types";

describe("pgVal", () => {
  it("passes through a plain value unquoted", () => {
    expect(pgVal("hello")).toBe("hello");
    expect(pgVal("abc123")).toBe("abc123");
  });

  it("quotes an empty string as a bare pair of quotes", () => {
    expect(pgVal("")).toBe('""');
  });

  it.each([
    ["a,b", '"a,b"'],
    ["a.b", '"a.b"'],
    ["a:b", '"a:b"'],
    ["a(b)", '"a(b)"'],
    ['a"b', '"a\\"b"'],
    ["a'b", "\"a'b\""],
    ["a\\b", '"a\\\\b"'],
    ["a{b}", '"a{b}"'],
    ["a[b]", '"a[b]"'],
    ["a b", '"a b"'],
    ["a\nb", '"a\nb"'],
  ])("quotes and escapes %j -> %j", (input, expected) => {
    expect(pgVal(input)).toBe(expected);
  });

  it("escapes backslashes before quotes so the quote escape can't be forged", () => {
    // A naively-ordered escape (quotes first, then backslashes) would let an
    // attacker-controlled backslash absorb the escaping backslash meant for a
    // quote. Verify backslash-then-quote escaping survives round-trip logic:
    // every literal `"` in the input must appear as `\"` in the output, and
    // every literal `\` must appear as `\\`.
    const input = 'a\\"b';
    const out = pgVal(input);
    expect(out).toBe('"a\\\\\\"b"');
  });

  it("handles unicode without corrupting it", () => {
    expect(pgVal("héllo")).toBe("héllo");
    expect(pgVal("日本語, test")).toBe('"日本語, test"');
  });

  it("handles a 200-char value", () => {
    const long = "a".repeat(200);
    expect(pgVal(long)).toBe(long);
    const longWithComma = "a".repeat(199) + ",";
    expect(pgVal(longWithComma)).toBe(`"${longWithComma}"`);
  });

  describe("injection probes", () => {
    it("cannot break out of the value position with a filter-string payload", () => {
      const payload = "a,tenant_id.neq.x";
      const out = pgVal(payload);
      // The whole thing must be one quoted unit — no bare, unescaped `,` that
      // a naive concatenation into `col.eq.<out>` could parse as a second
      // filter clause.
      expect(out).toBe('"a,tenant_id.neq.x"');
      expect(out.startsWith('"')).toBe(true);
      expect(out.endsWith('"')).toBe(true);
      // No unescaped quote in the middle that could terminate the value early.
      const inner = out.slice(1, -1);
      expect(inner.match(/(?<!\\)"/g)).toBeNull();
    });

    it("escapes an embedded quote-comma payload attempting to inject a second predicate", () => {
      const payload = '",tenant_id.neq.x,"';
      const out = pgVal(payload);
      const inner = out.slice(1, -1);
      expect(inner.match(/(?<!\\)"/g)).toBeNull();
    });

    it("escapes parens attempting to close an and()/or() combinator early", () => {
      const payload = "x),or(tenant_id.neq.y";
      const out = pgVal(payload);
      expect(out).toBe(`"${payload}"`);
    });
  });
});

describe("pgLike", () => {
  it("wraps a contains pattern in %...%", () => {
    expect(pgLike("abc", "contains")).toBe("%abc%");
  });

  it("wraps a prefix pattern as val%", () => {
    expect(pgLike("abc", "prefix")).toBe("abc%");
  });

  it("wraps a suffix pattern as %val", () => {
    expect(pgLike("abc", "suffix")).toBe("%abc");
  });

  it("leaves an exact pattern unwrapped", () => {
    expect(pgLike("abc", "exact")).toBe("abc");
  });

  it("escapes the user's OWN % before adding ours, so a literal % isn't a wildcard", () => {
    // Escaped pattern contains a backslash, so the final pgVal() pass also
    // quotes it and doubles that backslash — see the "pgLike always quotes
    // through pgVal" note below.
    expect(pgLike("50%", "contains")).toBe('"%50\\\\%%"');
  });

  it("escapes the user's OWN _ before adding ours", () => {
    expect(pgLike("a_b", "contains")).toBe('"%a\\\\_b%"');
  });

  it("escapes a literal backslash in the user's input", () => {
    expect(pgLike("a\\b", "contains")).toBe('"%a\\\\\\\\b%"');
  });

  it("quotes the final pattern when it needs quoting (e.g. contains a comma)", () => {
    expect(pgLike("a,b", "contains")).toBe('"%a,b%"');
  });

  it("does not mangle o'brien@x.co.uk — the live bug this file fixes", () => {
    // route.ts's `search.replace(/[,().]/g, "")` used to silently delete
    // characters from legitimate input. pgLike must preserve every character,
    // only escaping/quoting as needed.
    const out = pgLike("o'brien@x.co.uk", "contains");
    expect(out).toContain("o'brien@x.co.uk");
    expect(out).toBe("\"%o'brien@x.co.uk%\"");
  });

  it("handles a 200-char value", () => {
    const long = "b".repeat(200);
    expect(pgLike(long, "contains")).toBe(`%${long}%`);
  });
});

describe("pgCol", () => {
  it("returns the bare column when no jsonPath is given", () => {
    expect(pgCol("status")).toBe("status");
  });

  it("builds a ->> accessor for a valid jsonb key", () => {
    expect(pgCol("custom_fields", "field_of_study")).toBe("custom_fields->>field_of_study");
  });

  it("accepts alphanumeric + underscore keys up to 64 chars", () => {
    const key = "a".repeat(64);
    expect(pgCol("custom_fields", key)).toBe(`custom_fields->>${key}`);
  });

  it("rejects a 65-char key", () => {
    expect(() => pgCol("custom_fields", "a".repeat(65))).toThrow(FilterCompileError);
  });

  it("rejects a jsonPath attempting injection via special characters", () => {
    expect(() => pgCol("custom_fields", "x->>tenant_id.neq.y")).toThrow(FilterCompileError);
    expect(() => pgCol("custom_fields", "x'; drop table leads;--")).toThrow(FilterCompileError);
    expect(() => pgCol("custom_fields", "")).toThrow(FilterCompileError);
  });
});

describe("and / or / not combinators", () => {
  it("returns the bare predicate unwrapped when there is exactly one", () => {
    expect(and("a.eq.1")).toBe("a.eq.1");
    expect(or("a.eq.1")).toBe("a.eq.1");
  });

  it("wraps multiple predicates in and(...)", () => {
    expect(and("a.eq.1", "b.eq.2")).toBe("and(a.eq.1,b.eq.2)");
  });

  it("wraps multiple predicates in or(...)", () => {
    expect(or("a.eq.1", "b.eq.2")).toBe("or(a.eq.1,b.eq.2)");
  });

  it("supports nesting and() inside or()", () => {
    expect(or("a.eq.1", and("b.eq.2", "c.eq.3"))).toBe("or(a.eq.1,and(b.eq.2,c.eq.3))");
  });

  it("prefixes a predicate with not.", () => {
    expect(not("a.eq.1")).toBe("not.a.eq.1");
  });
});

describe("array literals", () => {
  it("EMPTY_ARRAY_LITERAL is a bare constant", () => {
    expect(EMPTY_ARRAY_LITERAL).toBe("{}");
  });

  it("builds a brace-delimited literal from plain values", () => {
    expect(arrayLiteral(["a", "b", "c"])).toBe("{a,b,c}");
  });

  it("escapes an element that itself needs quoting", () => {
    expect(arrayLiteral(["a,b", "c"])).toBe('{"a,b",c}');
  });

  it("never builds a literal from an untrusted raw string directly", () => {
    // arrayLiteral always goes element-by-element through pgVal — there is no
    // path that concatenates a raw joined string.
    const out = arrayLiteral(["}, tenant_id.neq.x, {"]);
    expect(out).toBe('{"}, tenant_id.neq.x, {"}');
  });
});
