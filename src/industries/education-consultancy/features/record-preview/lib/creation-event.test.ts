import { describe, it, expect } from "vitest";
import { creationDetailText, creationHow, ensureCreationEvent, isCreationAudit } from "./creation-event";
import type { PreviewActivity } from "../use-preview-data";

const ev = (o: Partial<PreviewActivity>): PreviewActivity => ({
  id: "x", at: "2026-11-01T00:00:00Z", actor_id: null, actor_name: null, source: null, kind: "call", verb: "logged a call", object: null, snippet: null, ...o,
});
const OPTS = { createdAt: "2026-10-10T00:00:00Z", sourceLabel: "Facebook form" };

describe("ensureCreationEvent", () => {
  it("no audit creation row: one synthetic row from created_at, form as a system actor", () => {
    const out = ensureCreationEvent([], OPTS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "created", verb: "created the lead", at: OPTS.createdAt, actor_id: null, source: "Facebook form" });
  });

  it("brand-new lead with another event: that event + the creation", () => {
    expect(ensureCreationEvent([ev({ id: "a" })], OPTS).map((e) => e.kind).sort()).toEqual(["call", "created"]);
  });

  it("audit creation row present: no duplicate, keeps the creating user", () => {
    const audit = ev({ id: "l-1", kind: "created", actor_id: "u1", actor_name: "Binod", verb: "Lead created", at: "2026-10-10T00:00:01Z" });
    const out = ensureCreationEvent([audit, ev({ id: "a" })], OPTS);
    expect(out.filter((e) => e.kind === "created")).toHaveLength(1);
    expect(out.find((e) => e.kind === "created")).toMatchObject({ id: "l-1", actor_id: "u1", verb: "created the lead" });
  });

  it("two creation rows collapse to one, preferring the one with a person", () => {
    const out = ensureCreationEvent([ev({ id: "s", kind: "created", source: "Website" }), ev({ id: "p", kind: "created", actor_id: "u2" })], OPTS);
    expect(out.filter((e) => e.kind === "created").map((e) => e.id)).toEqual(["p"]);
  });

  it("falls back to 'Imported' without any source", () => {
    expect(ensureCreationEvent([], { createdAt: OPTS.createdAt, sourceLabel: null })[0].source).toBe("Imported");
  });
});

describe("isCreationAudit", () => {
  it("plain create, first submission; not a re-submission or a stage move", () => {
    expect(isCreationAudit("created", {})).toBe(true);
    expect(isCreationAudit("submission", { is_first: { old: null, new: true } })).toBe(true);
    expect(isCreationAudit("submission", { is_first: { old: null, new: false } })).toBe(false);
    expect(isCreationAudit("stage", {})).toBe(false);
  });
});

describe("creationHow", () => {
  const ch = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { old: null, new: v }]));
  it("says how the lead came in, from the audit changes", () => {
    expect(creationHow(ch({ created_via: "manual" }))).toBe("manually");
    expect(creationHow(ch({ created_via: "public_form", form_name: "UK Intake" }))).toBe("via the UK Intake form");
    expect(creationHow(ch({ created_via: "public_form" }))).toBe("via a form");
    expect(creationHow(ch({ created_via: "public_api" }))).toBe("via the API");
    expect(creationHow(ch({ created_via: "integration" }))).toBe("via an integration");
  });
  it("null when nothing is known", () => {
    expect(creationHow(null)).toBeNull();
    expect(creationHow({})).toBeNull();
  });
});

describe("creationDetailText", () => {
  it("joins how, source, channel and campaign; only what is known", () => {
    expect(creationDetailText({ how: "via the UK form", source: "Facebook", channel: "Paid", campaign: "UK Intake" }, true))
      .toBe("via the UK form · Source: Facebook · Channel: Paid · Campaign: UK Intake");
    expect(creationDetailText({ how: "manually" }, true)).toBe("manually");
    expect(creationDetailText({ source: "Facebook" }, true)).toBe("· Source: Facebook");
    expect(creationDetailText({ source: "Facebook" }, false)).toBeNull();
    expect(creationDetailText({ how: " ", source: "", channel: null }, true)).toBeNull();
    expect(creationDetailText(undefined, true)).toBeNull();
  });
});

describe("ensureCreationEvent detail line", () => {
  const detail = { how: "via the UK form", source: "Facebook", channel: "Paid", campaign: "UK Intake" };
  it("a real creation row gets how + source + channel + campaign", () => {
    const audit = ev({ id: "l-1", kind: "created", actor_id: "u1", actor_name: "Binod", verb: "Lead created" });
    const out = ensureCreationEvent([audit], { ...OPTS, detail });
    expect(out.find((e) => e.kind === "created")?.object).toBe("via the UK form · Source: Facebook · Channel: Paid · Campaign: UK Intake");
  });
  it("a made-up creation row names the source as its actor, so the detail leaves the source out", () => {
    const out = ensureCreationEvent([], { ...OPTS, detail: { source: "Facebook form", channel: "Paid" } });
    expect(out[0]).toMatchObject({ source: "Facebook form", object: "· Channel: Paid" });
  });
  it("no detail: nothing extra (as before)", () => {
    expect(ensureCreationEvent([], OPTS)[0].object).toBeNull();
  });
});
