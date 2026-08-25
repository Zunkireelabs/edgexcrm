import { describe, it, expect } from "vitest";
import { renderMessage } from "./render";
import { countSegments } from "./segments";

describe("renderMessage", () => {
  it("composes sender prefix + body + opt-out footer into one string", () => {
    const out = renderMessage({
      body: "Hi {{first_name}}, your application is due Friday.",
      lead: { first_name: "Sita" },
      senderLabel: "Admizz",
      optOutFooter: "Opt out: edgex.zunkireelabs.com/u/aB3dEf9k",
    });

    expect(out).toBe(
      "Admizz\nHi Sita, your application is due Friday.\nOpt out: edgex.zunkireelabs.com/u/aB3dEf9k"
    );
  });

  it("§2f: the segment/credit count is computed on the FINAL string (prefix + body + footer), not the raw body", () => {
    // A body just under the 160-char GSM-7 single-segment limit; adding the
    // footer pushes the FINAL string over it into a 2-segment message. If a
    // caller ever counted segments on the raw body instead of renderMessage's
    // output, this would wrongly read as 1 segment / 1 credit.
    const rawBody = "x".repeat(150);
    const footer = "Opt out: edgex.zunkireelabs.com/u/aB3dEf9k"; // 43 chars + \n separator

    const rawOnly = countSegments(rawBody);
    expect(rawOnly.segments).toBe(1);

    const finalString = renderMessage({ body: rawBody, lead: {}, optOutFooter: footer });
    const final = countSegments(finalString);

    expect(finalString.length).toBeGreaterThan(160);
    expect(final.segments).toBeGreaterThan(rawOnly.segments);
  });

  it("never emits 'Reply STOP' or any variant — renderMessage throws if the footer contains it", () => {
    expect(() =>
      renderMessage({ body: "Hello", lead: {}, optOutFooter: "Reply STOP to opt out" })
    ).toThrow(/reply\s+stop/i);
  });

  it("the default Phase 2 footer text never matches the forbidden pattern", () => {
    const defaultFooter = "Opt out: edgex.zunkireelabs.com/u/aB3dEf9k";
    const out = renderMessage({ body: "Hello", lead: {}, optOutFooter: defaultFooter });
    expect(out).not.toMatch(/reply\s+stop/i);
  });

  it("omits the footer line entirely when none is supplied (Phase 1 behavior unchanged)", () => {
    const out = renderMessage({ body: "Hello", lead: {} });
    expect(out).toBe("Hello");
    expect(out).not.toContain("Opt out");
  });
});
