/** Display name for a team member: profile name → email local part in title case ("counselor@x" → "Counselor"). */
export function displayName(profileName: unknown, email: string | null | undefined): string {
  if (typeof profileName === "string" && profileName.trim()) return profileName.trim();
  const local = (email ?? "").split("@")[0].trim();
  if (!local) return "Unknown";
  return local.split(/[._\-+\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") || "Unknown";
}
