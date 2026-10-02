// The Collaborators filter's matching rule for surfaces that filter in the BROWSER over a fully
// loaded lead set (leads-organise's staging view, Contacts). Server-paginated surfaces (/leads)
// don't use this — there the list route applies the filter in SQL.
//
// Correct only because the `leadCollaborators` map it reads is now EXACT for every loaded lead
// (getLeadCollaboratorsMapForLeads pages past PostgREST's 1,000-row limit) — with a truncated
// map this rule would silently drop leads, which is what used to happen.

/** True when no collaborator is selected, or the lead has at least one selected collaborator. */
export function matchesCollaboratorFilter(
  leadId: string,
  selectedCollaboratorIds: readonly string[],
  leadCollaborators: Readonly<Record<string, readonly string[]>>,
): boolean {
  if (selectedCollaboratorIds.length === 0) return true;
  return leadCollaborators[leadId]?.some((userId) => selectedCollaboratorIds.includes(userId)) ?? false;
}
