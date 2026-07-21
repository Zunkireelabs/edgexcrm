/** Relative day label for a due/started timestamp, e.g. "due today", "in 2d", "3d ago". */
export function formatRelativeDay(iso: string): string {
  const target = new Date(iso);
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const diffDays = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return "due today";
  if (diffDays === 1) return "due tomorrow";
  if (diffDays > 1) return `due in ${diffDays}d`;
  if (diffDays === -1) return "due yesterday";
  return `due ${Math.abs(diffDays)}d ago`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
