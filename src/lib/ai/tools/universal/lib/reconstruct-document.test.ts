import { describe, it, expect } from "vitest";
import { reconstructDocument } from "./reconstruct-document";
import { OVERLAP_CHARS } from "@/lib/ai/ingestion/chunker";

describe("reconstructDocument", () => {
  it("returns a single chunk's content unchanged", () => {
    const result = reconstructDocument([{ chunkIndex: 0, content: "Hello world." }]);
    expect(result).toEqual({ text: "Hello world.", truncated: false });
  });

  it("strips the exact overlap prefix from a chunk that carries one", () => {
    const first = "A".repeat(1000);
    const overlapTail = first.slice(-OVERLAP_CHARS);
    const second = `${overlapTail}\n\nB`.concat("B".repeat(50));
    // second's content, as stored, is exactly what applyOverlap() would have produced:
    // prevTail + "\n\n" + own unique content.
    const ownUnique = "B".repeat(51);

    const result = reconstructDocument([
      { chunkIndex: 0, content: first },
      { chunkIndex: 1, content: second },
    ]);

    // Exact equality is the real assertion: if the overlap prefix weren't
    // stripped, the reconstructed text would be longer than first+ownUnique
    // by exactly one extra copy of overlapTail (plus the separator).
    expect(result.text).toBe(`${first}\n\n${ownUnique}`);
    expect(result.text.length).toBe(first.length + 2 + ownUnique.length);
    expect(result.truncated).toBe(false);
  });

  it("keeps a chunk whole when its start doesn't match the expected overlap prefix (section boundary / legacy row)", () => {
    const first = "First section content.";
    const second = "Second section content — no overlap prefix at all.";

    const result = reconstructDocument([
      { chunkIndex: 0, content: first },
      { chunkIndex: 1, content: second },
    ]);

    // Not corrupted — second kept exactly as stored, just joined.
    expect(result.text).toBe(`${first}\n\n${second}`);
  });

  it("sorts by chunkIndex before reconstructing, regardless of input order", () => {
    const result = reconstructDocument([
      { chunkIndex: 1, content: "second" },
      { chunkIndex: 0, content: "first" },
    ]);
    expect(result.text).toBe("first\n\nsecond");
  });

  it("truncates output over ~20k chars and sets the truncated flag", () => {
    const huge = "x".repeat(25_000);
    const result = reconstructDocument([{ chunkIndex: 0, content: huge }]);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(20_000);
  });

  it("does not truncate output at or under the cap", () => {
    const exact = "x".repeat(20_000);
    const result = reconstructDocument([{ chunkIndex: 0, content: exact }]);
    expect(result.truncated).toBe(false);
    expect(result.text.length).toBe(20_000);
  });
});
