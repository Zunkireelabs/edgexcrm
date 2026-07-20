import { describe, it, expect, vi, beforeEach } from "vitest";

const { generateTextMock, parseOfficeMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  parseOfficeMock: vi.fn(),
}));

vi.mock("ai", () => ({ generateText: generateTextMock }));
vi.mock("officeparser", () => ({ parseOffice: parseOfficeMock }));
vi.mock("@/lib/ai/provider", () => ({ model: vi.fn((kind: string) => `fake-model:${kind}`) }));

import { parseFileBytes, parseLink, htmlToText, ScannedPdfUnsupportedError } from "./parser";

beforeEach(() => {
  generateTextMock.mockReset();
  parseOfficeMock.mockReset();
});

describe("parseFileBytes — mime routing", () => {
  it("decodes text/plain as UTF-8", async () => {
    const bytes = new TextEncoder().encode("hello world");
    const result = await parseFileBytes(bytes, "text/plain");
    expect(result).toEqual({ text: "hello world" });
    expect(parseOfficeMock).not.toHaveBeenCalled();
  });

  it("decodes text/markdown and text/csv the same way", async () => {
    const bytes = new TextEncoder().encode("# heading\ncontent");
    expect(await parseFileBytes(bytes, "text/markdown")).toEqual({ text: "# heading\ncontent" });
    expect(await parseFileBytes(new TextEncoder().encode("a,b\n1,2"), "text/csv")).toEqual({
      text: "a,b\n1,2",
    });
  });

  it("routes docx through officeparser and returns toText() output", async () => {
    parseOfficeMock.mockResolvedValue({
      content: [],
      toText: () => "parsed docx text",
    });
    const result = await parseFileBytes(new Uint8Array([1, 2, 3]), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(result).toEqual({ text: "parsed docx text" });
    expect(parseOfficeMock).toHaveBeenCalledOnce();
    // Buffer-only magic-byte auto-detection is unreliable — pass the fileType hint explicitly.
    expect(parseOfficeMock.mock.calls[0][1]).toEqual({ fileType: "docx" });
  });

  it("extracts a page breakdown for a text-bearing PDF", async () => {
    parseOfficeMock.mockResolvedValue({
      content: [
        { type: "page", text: "page one text that is long enough to pass the scanned check.", metadata: { pageNumber: 1 } },
        { type: "page", text: "page two text that is also long enough to pass the scanned check.", metadata: { pageNumber: 2 } },
      ],
      toText: () => "page one text that is long enough to pass the scanned check.\npage two text that is also long enough to pass the scanned check.",
    });
    const result = await parseFileBytes(new Uint8Array([1, 2, 3]), "application/pdf");
    expect(result.pages).toEqual([
      { page: 1, text: "page one text that is long enough to pass the scanned check." },
      { page: 2, text: "page two text that is also long enough to pass the scanned check." },
    ]);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("falls back to OCR for a scanned PDF (parsed text under the threshold)", async () => {
    parseOfficeMock.mockResolvedValue({
      content: [{ type: "page", text: "x", metadata: { pageNumber: 1 } }],
      toText: () => "x",
    });
    generateTextMock.mockResolvedValue({ text: "OCR transcription" });

    const result = await parseFileBytes(new Uint8Array([1, 2, 3]), "application/pdf");

    expect(result).toEqual({ text: "OCR transcription", ocrUsage: { inputTokens: 0, outputTokens: 0 } });
    expect(generateTextMock).toHaveBeenCalledOnce();
    const call = generateTextMock.mock.calls[0][0];
    const filePart = call.messages[0].content.find((p: { type: string }) => p.type === "file");
    expect(filePart.mediaType).toBe("application/pdf");
  });

  it("marks a scanned PDF failed (via ScannedPdfUnsupportedError) when the provider rejects the file part", async () => {
    parseOfficeMock.mockResolvedValue({ content: [], toText: () => "" });
    generateTextMock.mockRejectedValue(new Error("provider does not support file parts"));

    await expect(parseFileBytes(new Uint8Array([1, 2, 3]), "application/pdf")).rejects.toThrow(
      ScannedPdfUnsupportedError,
    );
  });

  it("routes images through vision OCR", async () => {
    generateTextMock.mockResolvedValue({ text: "image transcription" });
    const result = await parseFileBytes(new Uint8Array([1, 2, 3]), "image/png");
    expect(result).toEqual({ text: "image transcription", ocrUsage: { inputTokens: 0, outputTokens: 0 } });
    const call = generateTextMock.mock.calls[0][0];
    const imagePart = call.messages[0].content.find((p: { type: string }) => p.type === "image");
    expect(imagePart.mediaType).toBe("image/png");
  });

  it("throws for an unsupported mime type", async () => {
    await expect(parseFileBytes(new Uint8Array([1]), "application/zip")).rejects.toThrow(/Unsupported mime type/);
  });
});

describe("htmlToText", () => {
  it("strips script/style/nav/header/footer blocks", () => {
    const html = `
      <html><body>
        <header>Site header</header>
        <nav>Nav links</nav>
        <script>alert('x')</script>
        <style>.a { color: red; }</style>
        <main>Real content here</main>
        <footer>Site footer</footer>
      </body></html>
    `;
    const text = htmlToText(html);
    expect(text).toContain("Real content here");
    expect(text).not.toContain("Site header");
    expect(text).not.toContain("Nav links");
    expect(text).not.toContain("alert(");
    expect(text).not.toContain("color: red");
    expect(text).not.toContain("Site footer");
  });

  it("decodes common HTML entities", () => {
    const html = "<p>Tom &amp; Jerry say &quot;hi&quot; &mdash; it&#39;s fun &nbsp;&nbsp;here</p>";
    const text = htmlToText(html);
    expect(text).toContain("Tom & Jerry");
    expect(text).toContain('"hi"');
    expect(text).toContain("it's fun");
  });

  it("collapses excess whitespace", () => {
    const html = "<p>a</p>\n\n\n\n<p>b</p>    <p>c</p>";
    const text = htmlToText(html);
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).not.toMatch(/ {2,}/);
  });
});

describe("parseLink", () => {
  const originalFetch = global.fetch;

  it("fetches and converts HTML to text", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "<html><body><main>Hello from the web</main></body></html>",
      body: null,
    })) as unknown as typeof fetch;

    const result = await parseLink("https://example.com");
    expect(result.text).toContain("Hello from the web");
    global.fetch = originalFetch;
  });

  it("throws on a non-OK response", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => "", body: null })) as unknown as typeof fetch;

    await expect(parseLink("https://example.com/missing")).rejects.toThrow(/404/);
    global.fetch = originalFetch;
  });
});
