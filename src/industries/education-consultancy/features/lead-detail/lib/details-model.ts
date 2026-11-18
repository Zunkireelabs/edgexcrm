export interface Collaborator {
  user_id: string;
  email: string;
  name: string;
}

/** The counsellor is never listed as a collaborator (the same person can be both in the data; the UI shows them once). */
export function visibleCollaborators(collaborators: Collaborator[], counsellorId: string | null | undefined): Collaborator[] {
  return collaborators.filter((c) => c.user_id !== counsellorId);
}

/**
 * Who gets add / remove controls on the Collaborators row: owner/admin, and a branch manager (team scope; the server checks the lead is in
 * their branch, #675). Everyone else is locked, except that a collaborator can always remove THEMSELVES (#669, see `canRemoveCollaborator`).
 */
export function collaboratorControls(isAdmin: boolean, isBranchManager = false): { canAdd: boolean; canRemove: boolean; lockTooltip: string | null } {
  return isAdmin || isBranchManager
    ? { canAdd: true, canRemove: true, lockTooltip: null }
    : { canAdd: false, canRemove: false, lockTooltip: "Only admins and branch managers can change collaborators" };
}

/** A collaborator can take themselves off a lead (#669); anyone else needs the add / remove right. */
export function canRemoveCollaborator(collaboratorId: string, currentUserId: string | null | undefined, canRemoveOthers: boolean): boolean {
  return canRemoveOthers || (!!currentUserId && collaboratorId === currentUserId);
}
