// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LeadRow = any;

export function leadHref(id: string): string {
  return `/leads/${id}`;
}

export function leadDisplayName(lead: { first_name?: string | null; last_name?: string | null }): string {
  return [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "(no name)";
}

export function formatLeadRow(l: LeadRow) {
  return {
    id: l.id,
    displayId: l.display_id ?? null,
    href: leadHref(l.id),
    name: leadDisplayName(l),
    email: l.email ?? null,
    phone: l.phone ?? null,
    stage: l.status ?? null,
    assignedTo: l.assigned_to ?? null,
    createdAt: l.created_at ?? null,
    lastActivityAt: l.last_activity_at ?? null,
    tags: l.tags ?? [],
  };
}
