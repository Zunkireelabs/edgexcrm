// Filter chips on /notifications. One source of truth for the UI (labels) and the API (type prefixes),
// so a chip can never ask for a category the server doesn't know.
export const NOTIFICATION_CATEGORIES = [
  { key: "leads", label: "Leads", prefixes: ["lead."] },
  { key: "tasks", label: "Tasks", prefixes: ["task."] },
  { key: "messages", label: "Messages", prefixes: ["inbox.", "email.", "note.", "outreach."] },
  { key: "leave", label: "Leave", prefixes: ["leave."] },
  { key: "team", label: "Team", prefixes: ["invite.", "team."] },
] as const;

export type NotificationCategoryKey = (typeof NOTIFICATION_CATEGORIES)[number]["key"];

export function isNotificationCategory(value: string | null): value is NotificationCategoryKey {
  return NOTIFICATION_CATEGORIES.some((c) => c.key === value);
}

/** PostgREST `.or()` expression matching every type in the category, e.g. `type.like.lead.*`. */
export function categoryOrFilter(key: NotificationCategoryKey): string {
  const category = NOTIFICATION_CATEGORIES.find((c) => c.key === key)!;
  return category.prefixes.map((p) => `type.like.${p}*`).join(",");
}
