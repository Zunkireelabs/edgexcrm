// The one "is this person an owner or admin?" rule. Client-safe (no server imports), so the same
// function decides both what a screen shows and what the API allows — they cannot drift apart.
// (ResolvedPermissions.baseTier is derived from the same role: owner→owner, admin→admin, else member.)
export function isOwnerOrAdmin(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
