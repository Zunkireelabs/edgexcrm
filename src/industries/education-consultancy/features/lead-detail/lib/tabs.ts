/**
 * The middle column's tab set (EDGEX-153). One row: Overview · Activity · Tasks · Notes, then the tabs that depend on
 * the tenant's features and the lead's stage. What does not fit goes into a "+N more" menu.
 */
export type TabId =
  | "overview" | "activity" | "tasks" | "notes"
  | "emails" | "consent" | "applications" | "classes" | "documents" | "checkins";

export const TAB_ORDER: readonly TabId[] = [
  "overview", "activity", "tasks", "notes", "emails", "consent", "applications", "classes", "documents", "checkins",
];

export const TAB_LABEL: Record<TabId, string> = {
  overview: "Overview", activity: "Activity", tasks: "Tasks", notes: "Notes", emails: "Emails",
  consent: "Consent & fee", applications: "Applications", classes: "Classes", documents: "Documents", checkins: "Check-ins",
};

/** Same unlock rules as today's cards (the page shell computes them; nothing is re-derived here). */
export interface TabUnlocks {
  emails: boolean;
  /** applicationsActive AND a consent template is active. */
  consent: boolean;
  applications: boolean;
  classes: boolean;
  documents: boolean;
  checkins: boolean;
}

export function availableTabs(u: TabUnlocks): TabId[] {
  return TAB_ORDER.filter((id) => {
    switch (id) {
      case "emails": return u.emails;
      case "consent": return u.consent;
      case "applications": return u.applications;
      case "classes": return u.classes;
      case "documents": return u.documents;
      case "checkins": return u.checkins;
      default: return true;
    }
  });
}

/** `?tab=` value → a tab that exists for this lead; anything else (missing, unknown, locked) = Overview. */
export function parseTab(raw: string | null | undefined, available: readonly TabId[]): TabId {
  const v = (raw ?? "").toLowerCase();
  return (available as readonly string[]).includes(v) ? (v as TabId) : "overview";
}

export const TAB_GAP = 4;

/**
 * How many of the tabs (in order) stay in the row. `widths` are the natural widths of every tab, `available` the row's
 * inner width, `moreWidth` the width of the "+N more" trigger (reserved only when something overflows).
 */
export function visibleTabCount(widths: readonly number[], available: number, moreWidth: number): number {
  const n = widths.length;
  if (n === 0) return 0;
  const total = widths.reduce((a, w) => a + w, 0) + TAB_GAP * (n - 1);
  if (total <= available) return n;
  let used = 0;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const next = used + (i > 0 ? TAB_GAP : 0) + widths[i];
    if (next + TAB_GAP + moreWidth > available) break;
    used = next;
    k = i + 1;
  }
  return Math.max(1, k);
}

/** The URL (path + search + hash) after switching to `id`: `?tab=` set, or dropped for Overview (the default); other params stay. */
export function tabHref(currentHref: string, id: TabId): string {
  const url = new URL(currentHref, "http://x.invalid");
  if (id === "overview") url.searchParams.delete("tab"); else url.searchParams.set("tab", id);
  return url.pathname + url.search + url.hash;
}
