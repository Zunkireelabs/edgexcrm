// localStorage prefs for the v2 leads grid (EDGEX-117): order, pins, renames and widths.
// Personal preferences only — they never touch the saved-view / unsaved-bar state.

import { loadColumnPrefs } from "@/lib/leads/column-prefs";
import { MAX_PINS, normalizeLayout } from "./grid-layout";

export const GRID_PREFS_VERSION = 1;
export const MIN_WIDTH = 60;
export const MAX_LABEL_LENGTH = 40;

export interface GridPrefs {
  keys: string[];
  pins: string[];
  labels: Record<string, string>;
  widths: Record<string, number>;
}

interface Stored extends GridPrefs {
  v: number;
}

export function gridPrefsKey(tenantId: string, userId: string, scope?: string): string {
  return `leads-grid-v2:${tenantId}:${userId}:${scope ?? ""}`;
}

export interface LoadArgs {
  tenantId: string;
  userId: string;
  scope?: string;
  /** Every column key a user may show (name excluded). Unknown keys are dropped. */
  validKeys: string[];
  /** v2 defaults for this view, already honouring excludeDefaultVisibleKeys / extraDefaultVisibleKeys. */
  defaultKeys: string[];
}

export function defaultPrefs(defaultKeys: string[]): GridPrefs {
  return { keys: [...defaultKeys], pins: [], labels: {}, widths: {} };
}

function cleanLabels(raw: unknown, valid: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!valid.has(k) || typeof v !== "string") continue;
    const t = v.trim().slice(0, MAX_LABEL_LENGTH);
    if (t) out[k] = t;
  }
  return out;
}

function cleanWidths(raw: unknown, valid: Set<string>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!valid.has(k) || typeof v !== "number" || !Number.isFinite(v)) continue;
    out[k] = Math.max(MIN_WIDTH, Math.round(v));
  }
  return out;
}

export function loadGridPrefs(args: LoadArgs): GridPrefs {
  const { tenantId, userId, scope, validKeys, defaultKeys } = args;
  const valid = new Set(validKeys);
  const withName = new Set([...validKeys, "name"]);
  try {
    const raw = localStorage.getItem(gridPrefsKey(tenantId, userId, scope));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored> | null;
      if (parsed && parsed.v === GRID_PREFS_VERSION && Array.isArray(parsed.keys)) {
        const keys = parsed.keys.filter((k): k is string => typeof k === "string" && valid.has(k));
        if (keys.length > 0) {
          const pins = Array.isArray(parsed.pins) ? parsed.pins.filter((p): p is string => typeof p === "string") : [];
          const layout = normalizeLayout(keys, pins.slice(0, MAX_PINS));
          return {
            ...layout,
            labels: cleanLabels(parsed.labels, withName),
            widths: cleanWidths(parsed.widths, withName),
          };
        }
      }
    }
  } catch {
    // corrupt JSON or blocked storage -> fall through to the legacy / default path
  }
  // No usable v2 record: adopt the user's legacy Edit-columns choice (minus Tag), else defaults.
  try {
    const legacy = loadColumnPrefs(tenantId, userId, validKeys, [], scope).filter((k) => k !== "tags");
    if (legacy.length > 0) return defaultPrefs(legacy);
  } catch {
    // ignore
  }
  return defaultPrefs(defaultKeys);
}

export function saveGridPrefs(tenantId: string, userId: string, prefs: GridPrefs, scope?: string): void {
  try {
    const stored: Stored = { v: GRID_PREFS_VERSION, ...prefs };
    localStorage.setItem(gridPrefsKey(tenantId, userId, scope), JSON.stringify(stored));
  } catch {
    // private mode / quota — silent, the grid still works for this session
  }
}

/** Reset to default: removes the v2 record, so order, pins, renames and widths all clear. */
export function clearGridPrefs(tenantId: string, userId: string, scope?: string): void {
  try {
    localStorage.removeItem(gridPrefsKey(tenantId, userId, scope));
  } catch {
    // silent
  }
}
