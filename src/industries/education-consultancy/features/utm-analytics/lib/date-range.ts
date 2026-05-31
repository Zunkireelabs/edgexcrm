export type UtmDateFilter = "today" | "week" | "month" | "all";

export const UTM_DATE_FILTER_OPTIONS: { value: UtmDateFilter; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

export function getUtmDateCutoff(filter: UtmDateFilter): Date | null {
  if (filter === "all") return null;
  const now = new Date();
  const cutoff = new Date(now);
  switch (filter) {
    case "today":
      cutoff.setHours(0, 0, 0, 0);
      return cutoff;
    case "week":
      cutoff.setDate(cutoff.getDate() - 7);
      cutoff.setHours(0, 0, 0, 0);
      return cutoff;
    case "month":
      cutoff.setDate(cutoff.getDate() - 30);
      cutoff.setHours(0, 0, 0, 0);
      return cutoff;
  }
}
