import { describe, it, expect } from "vitest";
import { countSegments, detectEncoding } from "./segments";

describe("detectEncoding", () => {
  it("classifies plain ASCII as gsm7", () => {
    expect(detectEncoding("Hello, this is a test message.")).toBe("gsm7");
  });

  it("classifies a single Devanagari character as unicode for the whole message", () => {
    expect(detectEncoding("Hello नमस्ते")).toBe("unicode");
  });

  it("keeps GSM-7 extension characters (^ { } \\ [ ] ~ | €) as gsm7, not unicode", () => {
    expect(detectEncoding("Price: 100€ ^{}\\[]~|")).toBe("gsm7");
  });
});

describe("countSegments — GSM-7 boundary table", () => {
  it("159 chars stays in a single segment with 1 char remaining", () => {
    const info = countSegments("a".repeat(159));
    expect(info.encoding).toBe("gsm7");
    expect(info.chars).toBe(159);
    expect(info.segments).toBe(1);
    expect(info.credits).toBe(1);
    expect(info.charsRemaining).toBe(1);
  });

  it("160 chars is exactly one full single segment", () => {
    const info = countSegments("a".repeat(160));
    expect(info.segments).toBe(1);
    expect(info.credits).toBe(1);
    expect(info.charsRemaining).toBe(0);
  });

  it("161 chars rolls over into a 2-segment concatenated message (153/segment)", () => {
    const info = countSegments("a".repeat(161));
    expect(info.segments).toBe(2);
    expect(info.credits).toBe(2);
  });

  it("306 chars (153*2) fits exactly in 2 segments", () => {
    const info = countSegments("a".repeat(306));
    expect(info.segments).toBe(2);
  });

  it("307 chars rolls into a 3rd segment", () => {
    const info = countSegments("a".repeat(307));
    expect(info.segments).toBe(3);
  });

  it("€ costs 2 characters toward the GSM-7 count", () => {
    const withoutEuro = countSegments("a".repeat(158));
    const withEuro = countSegments("a".repeat(158) + "€");
    expect(withoutEuro.chars).toBe(158);
    expect(withEuro.chars).toBe(160); // 158 + 2 for the extension-table €
    expect(withEuro.encoding).toBe("gsm7");
  });
});

describe("countSegments — Unicode boundary table", () => {
  it("70 chars stays in a single segment", () => {
    const info = countSegments("न".repeat(70));
    expect(info.encoding).toBe("unicode");
    expect(info.chars).toBe(70);
    expect(info.segments).toBe(1);
    expect(info.credits).toBe(1);
    expect(info.charsRemaining).toBe(0);
  });

  it("71 chars rolls into a 2-segment concatenated message (67/segment)", () => {
    const info = countSegments("न".repeat(71));
    expect(info.segments).toBe(2);
    expect(info.credits).toBe(2);
  });

  it("67 chars single Devanagari segment", () => {
    const info = countSegments("न".repeat(67));
    expect(info.segments).toBe(1);
  });

  it("134 chars (67*2) fits exactly in 2 unicode segments", () => {
    const info = countSegments("न".repeat(134));
    expect(info.segments).toBe(2);
  });

  it("135 chars rolls into a 3rd unicode segment", () => {
    const info = countSegments("न".repeat(135));
    expect(info.segments).toBe(3);
  });

  it("a single non-GSM7 character forces the entire message to unicode segmentation", () => {
    const info = countSegments("Hello there, friend न");
    expect(info.encoding).toBe("unicode");
  });
});

describe("countSegments — empty input", () => {
  it("empty string is 0 segments / 0 credits", () => {
    const info = countSegments("");
    expect(info.segments).toBe(0);
    expect(info.credits).toBe(0);
  });
});
