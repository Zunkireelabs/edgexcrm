import { describe, it, expect } from "vitest";
import { chunkDocument, estimateTokens, TARGET_CHARS } from "./chunker";

describe("estimateTokens", () => {
  it("estimates chars/4", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("chunkDocument", () => {
  it("returns 0 chunks for empty input", () => {
    expect(chunkDocument({ text: "" })).toEqual([]);
    expect(chunkDocument({ text: "   \n  " })).toEqual([]);
  });

  it("returns 1 chunk for tiny input", () => {
    const chunks = chunkDocument({ text: "Just a short note." });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("Just a short note.");
    expect(chunks[0].page).toBeUndefined();
    expect(chunks[0].section).toBeUndefined();
  });

  it("splits long text into multiple chunks sized near the target, with overlap", () => {
    const paragraph = "Sentence number goes here for padding purposes. ".repeat(20).trim();
    const paragraphs = Array.from({ length: 8 }, (_, i) => `${paragraph} Paragraph index ${i}.`);
    const text = paragraphs.join("\n\n");

    const chunks = chunkDocument({ text });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Overlap can push a chunk somewhat past TARGET_CHARS — allow slack.
      expect(chunk.content.length).toBeLessThan(TARGET_CHARS * 1.5);
    }

    // Consecutive chunks overlap: chunk[i] starts with a tail slice of chunk[i-1].
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1].content.slice(-50);
      expect(chunks[i].content).toContain(prevTail.slice(-20));
    }
  });

  it("never merges content across page boundaries", () => {
    const pageAText = "Alpha content. ".repeat(200);
    const pageBText = "Beta content. ".repeat(200);
    const chunks = chunkDocument({
      text: `${pageAText}\n\n${pageBText}`,
      pages: [
        { page: 1, text: pageAText },
        { page: 2, text: pageBText },
      ],
    });

    const page1Chunks = chunks.filter((c) => c.page === 1);
    const page2Chunks = chunks.filter((c) => c.page === 2);
    expect(page1Chunks.length).toBeGreaterThan(0);
    expect(page2Chunks.length).toBeGreaterThan(0);
    for (const c of page1Chunks) expect(c.content).not.toContain("Beta content");
    for (const c of page2Chunks) expect(c.content).not.toContain("Alpha content");
  });

  it("carries the nearest markdown heading as the chunk's section", () => {
    const text = [
      "# Introduction",
      "",
      "This is the intro paragraph with enough text to form its own chunk content.",
      "",
      "## Details",
      "",
      "This is the details paragraph with different content entirely.",
    ].join("\n");

    const chunks = chunkDocument({ text });
    const intro = chunks.find((c) => c.content.includes("intro paragraph"));
    const details = chunks.find((c) => c.content.includes("details paragraph"));

    expect(intro?.section).toBe("Introduction");
    expect(details?.section).toBe("Details");
  });
});
