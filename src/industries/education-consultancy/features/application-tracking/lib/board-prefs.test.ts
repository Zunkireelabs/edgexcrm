import { describe, it, expect, afterEach, vi } from "vitest";
import {
  EMPTY_PREFS,
  isStageCollapsed,
  readBoardPrefs,
  setHidden,
  setTrackTime,
  toggleCollapse,
  writeBoardPrefs,
} from "./board-prefs";

const active = { id: "a", is_terminal: false, terminal_type: null } as const;
const won = { id: "w", is_terminal: true, terminal_type: "won" } as const;
const lostOnlyType = { id: "l", is_terminal: false, terminal_type: "lost" } as const;

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("finished-stage collapse", () => {
  it("finished stages (is_terminal or terminal_type) start collapsed; active ones do not", () => {
    expect(isStageCollapsed(won, EMPTY_PREFS)).toBe(true);
    expect(isStageCollapsed(lostOnlyType, EMPTY_PREFS)).toBe(true);
    expect(isStageCollapsed(active, EMPTY_PREFS)).toBe(false);
  });

  it("expanding a finished stage is remembered; collapsing it again clears it", () => {
    const opened = toggleCollapse(won, EMPTY_PREFS);
    expect(isStageCollapsed(won, opened)).toBe(false);
    expect(isStageCollapsed(won, toggleCollapse(won, opened))).toBe(true);
  });

  it("an active stage can be collapsed by the user", () => {
    expect(isStageCollapsed(active, toggleCollapse(active, EMPTY_PREFS))).toBe(true);
  });

  it("stored expand choice survives a write/read round-trip, keyed by user + pipeline", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage() });
    writeBoardPrefs("u1", "p1", toggleCollapse(won, EMPTY_PREFS));
    expect(isStageCollapsed(won, readBoardPrefs("u1", "p1"))).toBe(false);
    expect(isStageCollapsed(won, readBoardPrefs("u2", "p1"))).toBe(true);
    expect(isStageCollapsed(won, readBoardPrefs("u1", "p2"))).toBe(true);
  });

  it("renders with defaults when localStorage throws", () => {
    const boom = () => {
      throw new Error("denied");
    };
    vi.stubGlobal("window", { localStorage: { getItem: boom, setItem: boom } });
    expect(readBoardPrefs("u1", "p1")).toEqual(EMPTY_PREFS);
    expect(() => writeBoardPrefs("u1", "p1", EMPTY_PREFS)).not.toThrow();
  });

  it("ignores corrupt stored JSON", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage({ "edgex-applications-board:u1:p1": "{nope" }) });
    expect(readBoardPrefs("u1", "p1")).toEqual(EMPTY_PREFS);
  });
});

describe("hide + track time", () => {
  it("hides and restores a stage", () => {
    const h = setHidden(EMPTY_PREFS, "a", true);
    expect(h.hidden).toEqual(["a"]);
    expect(setHidden(h, "a", false).hidden).toEqual([]);
  });
  it("track time off records the stage; on removes it", () => {
    const off = setTrackTime(EMPTY_PREFS, "a", false);
    expect(off.noAge).toEqual(["a"]);
    expect(setTrackTime(off, "a", true).noAge).toEqual([]);
  });
});
