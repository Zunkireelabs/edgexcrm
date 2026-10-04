import { describe, expect, it } from "vitest";
import { PROGRESS_CAP, nextProgress, shouldStartForClick, type ClickInput } from "./route-progress";

describe("nextProgress", () => {
  it("climbs monotonically and never exceeds the cap", () => {
    let p = 0;
    for (let i = 0; i < 500; i++) {
      const next = nextProgress(p);
      expect(next).toBeGreaterThanOrEqual(p);
      expect(next).toBeLessThanOrEqual(PROGRESS_CAP);
      p = next;
    }
    expect(p).toBe(PROGRESS_CAP);
  });

  it("is fast at first and slows as it nears the cap", () => {
    expect(nextProgress(0) - 0).toBeGreaterThan(nextProgress(80) - 80);
  });

  it("holds at the cap", () => {
    expect(nextProgress(PROGRESS_CAP)).toBe(PROGRESS_CAP);
    expect(nextProgress(99)).toBe(PROGRESS_CAP);
  });

  it("gets to ~90% in a few seconds at one tick per 100ms", () => {
    let p = 0;
    let ticks = 0;
    while (p < 85) {
      p = nextProgress(p);
      ticks++;
    }
    expect(ticks * 100).toBeLessThan(4000);
  });
});

const CURRENT = "https://crm.example.com/leads?stage=new";
const click = (over: Partial<ClickInput> & { href?: string } = {}): ClickInput => ({
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  anchor: { href: over.href ?? "/pipeline", target: null, hasDownload: false, optOut: false, ...over.anchor },
  ...(over.anchor === null ? { anchor: null } : {}),
  ...("button" in over ? { button: over.button! } : {}),
  ...("metaKey" in over ? { metaKey: over.metaKey! } : {}),
  ...("ctrlKey" in over ? { ctrlKey: over.ctrlKey! } : {}),
  ...("shiftKey" in over ? { shiftKey: over.shiftKey! } : {}),
});

describe("shouldStartForClick", () => {
  it("starts for a plain click on an internal link to another page", () => {
    expect(shouldStartForClick(click({ href: "/pipeline" }), CURRENT)).toBe(true);
    expect(shouldStartForClick(click({ href: "https://crm.example.com/contacts" }), CURRENT)).toBe(true);
  });

  it("starts when only the query string differs", () => {
    expect(shouldStartForClick(click({ href: "/leads?stage=won" }), CURRENT)).toBe(true);
  });

  it("does not start for the page we're already on, or a hash-only jump", () => {
    expect(shouldStartForClick(click({ href: "/leads?stage=new" }), CURRENT)).toBe(false);
    expect(shouldStartForClick(click({ href: "#details" }), CURRENT)).toBe(false);
    expect(shouldStartForClick(click({ href: "/leads?stage=new#top" }), CURRENT)).toBe(false);
  });

  it("does not start for external links or non-http schemes", () => {
    expect(shouldStartForClick(click({ href: "https://other.com/x" }), CURRENT)).toBe(false);
    expect(shouldStartForClick(click({ href: "mailto:a@b.com" }), CURRENT)).toBe(false);
    expect(shouldStartForClick(click({ href: "tel:+9779800000000" }), CURRENT)).toBe(false);
    expect(shouldStartForClick(click({ href: "javascript:void(0)" }), CURRENT)).toBe(false);
  });

  it("does not start for modified or non-primary clicks", () => {
    expect(shouldStartForClick(click({ metaKey: true }), CURRENT)).toBe(false);
    expect(shouldStartForClick(click({ ctrlKey: true }), CURRENT)).toBe(false);
    expect(shouldStartForClick(click({ shiftKey: true }), CURRENT)).toBe(false);
    expect(shouldStartForClick(click({ button: 1 }), CURRENT)).toBe(false);
  });

  it("does not start for new-tab, download, or opted-out links, or when there is no link", () => {
    expect(shouldStartForClick(click({ anchor: { href: "/x", target: "_blank", hasDownload: false, optOut: false } }), CURRENT)).toBe(false);
    expect(shouldStartForClick(click({ anchor: { href: "/x", target: null, hasDownload: true, optOut: false } }), CURRENT)).toBe(false);
    expect(shouldStartForClick(click({ anchor: { href: "/x", target: null, hasDownload: false, optOut: true } }), CURRENT)).toBe(false);
    expect(shouldStartForClick(click({ anchor: null }), CURRENT)).toBe(false);
  });

  it("treats target=_self like no target", () => {
    expect(shouldStartForClick(click({ anchor: { href: "/pipeline", target: "_self", hasDownload: false, optOut: false } }), CURRENT)).toBe(true);
  });

  it("is safe on a malformed current URL", () => {
    expect(shouldStartForClick(click(), "not a url")).toBe(false);
  });
});
