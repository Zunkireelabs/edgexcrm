import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PersonNote } from "./scoreboard";

const LONG = "Eleven new leads untouched for three days; reassign before they go cold this week ok";
const html = (kind: "red" | "amber" | "green", text: string, ai: boolean) =>
  renderToStaticMarkup(<PersonNote note={{ kind, text }} ai={ai} />);

describe("PersonNote", () => {
  it("AI note: rnote span, title = full text, Spark svg before span.nt", () => {
    const out = html("red", LONG, true);
    expect(LONG.length).toBeGreaterThanOrEqual(80);
    expect(out.startsWith(`<span class="rnote" title="${LONG}">`)).toBe(true);
    expect(out).toContain(`<span class="nt">${LONG}</span>`);
    expect(out.indexOf("<svg")).toBeGreaterThan(-1);
    expect(out.indexOf("<svg")).toBeLessThan(out.indexOf('<span class="nt">'));
    expect(out.endsWith("</span></span>")).toBe(true);
  });

  it.each([
    ["red", "flag "],
    ["amber", "flag am"],
    ["green", "flag gd"],
  ] as const)("plain %s note: title = full text, text inside span.nt, no svg", (kind, cls) => {
    const out = html(kind, LONG, false);
    expect(out).toBe(`<span class="${cls}" title="${LONG}"><span class="nt">${LONG}</span></span>`);
    expect(out).not.toContain("<svg");
  });

  it("short text is not altered", () => {
    expect(html("amber", "Slow replies", false)).toContain('title="Slow replies"><span class="nt">Slow replies</span>');
  });
});
