// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearGridPrefs, defaultPrefs, gridPrefsKey, loadGridPrefs, saveGridPrefs } from "./grid-prefs";

const T = "t1";
const U = "u1";
const validKeys = ["lead_type", "assigned", "email", "location", "display_id", "last_activity", "tags", "phone"];
const defaultKeys = ["lead_type", "assigned", "email"];
const args = { tenantId: T, userId: U, validKeys, defaultKeys };

beforeEach(() => localStorage.clear());

describe("loadGridPrefs", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadGridPrefs(args)).toEqual(defaultPrefs(defaultKeys));
  });
  it("falls back to defaults on corrupt JSON", () => {
    localStorage.setItem(gridPrefsKey(T, U), "{not json");
    expect(loadGridPrefs(args)).toEqual(defaultPrefs(defaultKeys));
  });
  it("drops unknown keys, bad labels and bad widths", () => {
    localStorage.setItem(
      gridPrefsKey(T, U),
      JSON.stringify({
        v: 1,
        keys: ["email", "ghost", "phone"],
        pins: ["phone", "ghost"],
        labels: { email: "  Mail  ", ghost: "x", phone: 5, name: "People" },
        widths: { email: 10, ghost: 200, phone: "wide", name: 300 },
      }),
    );
    const p = loadGridPrefs(args);
    expect(p.keys).toEqual(["phone", "email"]);
    expect(p.pins).toEqual(["phone"]);
    expect(p.labels).toEqual({ email: "Mail", name: "People" });
    expect(p.widths).toEqual({ email: 60, name: 300 });
  });
  it("truncates labels to 40 characters", () => {
    localStorage.setItem(gridPrefsKey(T, U), JSON.stringify({ v: 1, keys: ["email"], pins: [], labels: { email: "x".repeat(60) }, widths: {} }));
    expect(loadGridPrefs(args).labels.email).toHaveLength(40);
  });
  it("ignores a wrong version", () => {
    localStorage.setItem(gridPrefsKey(T, U), JSON.stringify({ v: 9, keys: ["email"], pins: [], labels: {}, widths: {} }));
    expect(loadGridPrefs(args).keys).toEqual(defaultKeys);
  });
  it("legacy fallback adopts the old choice and drops tags", () => {
    localStorage.setItem(`leads_columns_${T}_${U}`, JSON.stringify({ v: 1, columns: ["tags", "phone", "email"] }));
    const p = loadGridPrefs(args);
    expect(p.keys).toEqual(["phone", "email"]);
    expect(p.pins).toEqual([]);
  });
  it("legacy that is only tags falls back to defaults", () => {
    localStorage.setItem(`leads_columns_${T}_${U}`, JSON.stringify({ v: 1, columns: ["tags"] }));
    expect(loadGridPrefs(args).keys).toEqual(defaultKeys);
  });
  it("is scoped per view", () => {
    saveGridPrefs(T, U, { keys: ["email"], pins: [], labels: {}, widths: {} }, "archived");
    expect(loadGridPrefs({ ...args, scope: "archived" }).keys).toEqual(["email"]);
    expect(loadGridPrefs(args).keys).toEqual(defaultKeys);
  });
});

describe("save / clear", () => {
  it("round-trips and reset clears everything", () => {
    saveGridPrefs(T, U, { keys: ["email", "phone"], pins: ["phone"], labels: { email: "Mail" }, widths: { email: 200 } });
    expect(loadGridPrefs(args)).toEqual({ keys: ["phone", "email"], pins: ["phone"], labels: { email: "Mail" }, widths: { email: 200 } });
    clearGridPrefs(T, U);
    expect(loadGridPrefs(args)).toEqual(defaultPrefs(defaultKeys));
  });
});
