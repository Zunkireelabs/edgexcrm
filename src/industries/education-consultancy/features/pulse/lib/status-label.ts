/** A status slug as a label: the tenant's own label when it has one, else the slug in sentence case ("follow_up" → "Follow up"). */
export function statusLabel(slug: string | null | undefined, labels: Record<string, string> = {}): string {
  if (!slug) return "—";
  const own = labels[slug];
  if (own && own.trim()) return own.trim();
  const words = slug.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "—";
}

/** "contacted → follow_up" → "Contacted → Follow up". */
export function statusChangeLabel(detail: string | null | undefined, labels: Record<string, string> = {}): string | null {
  if (!detail) return null;
  const parts = detail.split("→").map((s) => s.trim());
  return parts.length === 2 ? `${statusLabel(parts[0], labels)} → ${statusLabel(parts[1], labels)}` : detail;
}
