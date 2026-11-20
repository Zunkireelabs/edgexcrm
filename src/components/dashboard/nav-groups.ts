/**
 * Pure helpers for the sidebar's foldable groups (EDGEX-86). React-free so the
 * rules are unit-testable (this project has no React Testing Library for the shell).
 */

/** Cookie holding `{ [groupId]: open }` for one tenant. A cookie (not localStorage) so the server layout can render the right fold state on first paint. */
export function navGroupsCookieName(tenantId: string): string {
  return `nav-groups-${tenantId}`;
}

const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** The `document.cookie` assignment string for the fold state (path=/, 1 year, SameSite=Lax). */
export function serializeGroupsCookie(tenantId: string, state: Record<string, boolean>): string {
  return `${navGroupsCookieName(tenantId)}=${encodeURIComponent(JSON.stringify(state))}; path=/; max-age=${ONE_YEAR_S}; SameSite=Lax`;
}

/** Reads a cookie value (raw or already URI-decoded, as Next's cookies() returns it). Malformed → null. */
export function parseGroupsCookie(value: string | null | undefined): Record<string, boolean> | null {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // not URI-encoded — parse as is
  }
  return parseStoredGroups(decoded);
}

/** Parses the stored value defensively; anything malformed is "nothing stored". */
export function parseStoredGroups(raw: string | null): Record<string, boolean> | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const out: Record<string, boolean> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "boolean") out[k] = val;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Open/closed state for every group id in `defaults` (true = open).
 * Order of precedence: the group containing the current route is ALWAYS open →
 * the stored per-browser choice → the layout default.
 */
export function groupOpenState(
  stored: Record<string, boolean> | null,
  defaults: Record<string, boolean>,
  activeGroupId: string | null,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of Object.keys(defaults)) {
    out[id] = stored && typeof stored[id] === "boolean" ? stored[id] : defaults[id];
  }
  if (activeGroupId && activeGroupId in out) out[activeGroupId] = true;
  return out;
}

/** True when `pathname` is `href` or a sub-route of it (`/leads` matches `/leads/123`, not `/leads-organise`). */
export function pathMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The page a layout entry key stands for, used only to decide which group holds the current route.
 * `universal:/x` → `/x`; `slot:lead-lists|leads-funnels` → `/leads`; `slot:leads-organise` →
 * `/leads-organise`; other slots → null; a plain href is itself.
 */
export function navEntryHref(key: string): string | null {
  if (key.startsWith("universal:")) return key.slice("universal:".length);
  if (key === "slot:lead-lists" || key === "slot:leads-funnels") return "/leads";
  if (key === "slot:leads-organise") return "/leads-organise";
  if (key.startsWith("slot:")) return null;
  return key;
}

/** Id of the first section (in layout order) whose entries contain the current route, else null. */
export function activeSectionId(
  layout: readonly { id: string; entries: readonly string[] }[],
  pathname: string,
): string | null {
  for (const section of layout) {
    for (const key of section.entries) {
      const href = navEntryHref(key);
      if (href && pathMatches(pathname, href)) return section.id;
    }
  }
  return null;
}
