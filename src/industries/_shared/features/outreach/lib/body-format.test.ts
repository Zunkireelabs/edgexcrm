import { describe, expect, it } from "vitest";
import { detectBodyMode, fillSampleMergeTags, findTagsWithoutFallback } from "./body-format";

describe("detectBodyMode", () => {
  it("keeps plain TipTap output in rich mode", () => {
    expect(detectBodyMode("")).toBe("rich");
    expect(detectBodyMode("<p>Hi {{first_name}}, <strong>quick</strong> <em>note</em></p>")).toBe("rich");
    expect(detectBodyMode('<p><a href="https://x.com">link</a></p><ul><li>a</li></ul>')).toBe("rich");
    expect(detectBodyMode('<a target="_blank" rel="noopener noreferrer nofollow" href="https://x.com">x</a><h2>t</h2><blockquote><p>q</p></blockquote><pre><code>c</code></pre><hr>')).toBe("rich");
  });

  it("opens designed email markup in html mode", () => {
    expect(detectBodyMode("<table><tr><td>x</td></tr></table>")).toBe("html");
    expect(detectBodyMode("<style>p{color:red}</style><p>x</p>")).toBe("html");
    expect(detectBodyMode('<p style="color:red">x</p>')).toBe("html");
    expect(detectBodyMode('<img src="a.png">')).toBe("html");
    expect(detectBodyMode("<!doctype html><html><body>x</body></html>")).toBe("html");
    expect(detectBodyMode("<!--[if mso]><p>x</p><![endif]-->")).toBe("html");
    expect(detectBodyMode('<p align="center">x</p>')).toBe("html");
    expect(detectBodyMode('<h1>Hi</h1><button>Go</button>')).toBe("html");
  });
});

describe("fillSampleMergeTags", () => {
  it("fills known tags and blanks unknown ones", () => {
    expect(fillSampleMergeTags("Hi {{first_name}} {{last_name}} {{nope}}!")).toBe("Hi Jane Doe !");
  });
});

describe("fallbacks in the preview and the editor hint", () => {
  it("preview: a known tag shows its sample (never the fallback); an unknown tag shows its fallback, else nothing", () => {
    expect(fillSampleMergeTags("Hi {{first_name|there}} {{nickname|friend}} {{nope}}!")).toBe("Hi Jane friend !");
  });

  it("findTagsWithoutFallback lists often-empty tags used with no fallback", () => {
    expect(findTagsWithoutFallback("Hi {{first_name}}, from {{city}} — {{tenant_name}} {{email}}")).toEqual(["first_name", "city"]);
    expect(findTagsWithoutFallback("Hi {{first_name|there}}, {{last_name | }}")).toEqual([]);
    expect(findTagsWithoutFallback("no tags at all")).toEqual([]);
    expect(findTagsWithoutFallback("{{first_name}} {{first_name}}")).toEqual(["first_name"]);
  });
});
