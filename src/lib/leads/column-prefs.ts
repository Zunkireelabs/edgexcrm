const PREFS_VERSION = 1;

function prefsKey(tenantId: string, userId: string, scope?: string): string {
  return `leads_columns_${tenantId}_${userId}${scope ? `_${scope}` : ""}`;
}

interface StoredPrefs {
  v: number;
  columns: string[];
}

/**
 * Load persisted visible column keys for a tenant+user.
 * Filters out unknown keys (removed custom fields, wrong-industry columns).
 * Falls back to defaults if no prefs exist or storage throws.
 */
export function loadColumnPrefs(
  tenantId: string,
  userId: string,
  validKeys: string[],
  defaults: string[],
  scope?: string,
): string[] {
  try {
    const raw = localStorage.getItem(prefsKey(tenantId, userId, scope));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
    if (parsed.v !== PREFS_VERSION || !Array.isArray(parsed.columns)) return defaults;
    const valid = new Set(validKeys);
    const filtered = parsed.columns.filter((k) => valid.has(k));
    return filtered.length > 0 ? filtered : defaults;
  } catch {
    return defaults;
  }
}

/** Persist visible column keys for a tenant+user. */
export function saveColumnPrefs(
  tenantId: string,
  userId: string,
  columns: string[],
  scope?: string,
): void {
  try {
    const prefs: StoredPrefs = { v: PREFS_VERSION, columns };
    localStorage.setItem(prefsKey(tenantId, userId, scope), JSON.stringify(prefs));
  } catch {
    // private mode or storage full — silent
  }
}

/** Remove persisted prefs so the next load returns defaults. */
export function clearColumnPrefs(tenantId: string, userId: string, scope?: string): void {
  try {
    localStorage.removeItem(prefsKey(tenantId, userId, scope));
  } catch {
    // silent
  }
}
