import { describe, it, expect } from "vitest";
import { ensureCreationEvent, isCreationAudit } from "./creation-event";
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
