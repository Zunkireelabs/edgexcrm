export interface Collaborator {
  user_id: string;
  email: string;
  name: string;
}

/** The counsellor is never listed as a collaborator (the same person can be both in the data; the UI shows them once). */
export function visibleCollaborators(collaborators: Collaborator[], counsellorId: string | null | undefined): Collaborator[] {
  return collaborators.filter((c) => c.user_id !== counsellorId);
}

/** Who gets add / remove controls on the Collaborators row: owner/admin only (the server already 403s everyone else). */
export function collaboratorControls(isAdmin: boolean): { canAdd: boolean; canRemove: boolean; lockTooltip: string | null } {
  return isAdmin
    ? { canAdd: true, canRemove: true, lockTooltip: null }
    : { canAdd: false, canRemove: false, lockTooltip: "Only admins can change collaborators" };
}
