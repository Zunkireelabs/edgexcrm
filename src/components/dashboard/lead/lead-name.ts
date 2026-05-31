import type { Lead } from "@/types/database";

const FULLNAME_CUSTOM_KEYS = ["fullname", "full_name", "name"] as const;

function readFullnameCustomField(
  customFields: Record<string, unknown> | null | undefined,
): string {
  if (!customFields) return "";
  for (const key of FULLNAME_CUSTOM_KEYS) {
    const value = customFields[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function getLeadFullName(
  lead: Pick<Lead, "first_name" | "last_name" | "custom_fields">,
  fallback = "Unknown",
): string {
  const joined = [lead.first_name, lead.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (joined) return joined;
  const fromCustom = readFullnameCustomField(lead.custom_fields);
  if (fromCustom) return fromCustom;
  return fallback;
}

export function getLeadInitials(
  lead: Pick<Lead, "first_name" | "last_name" | "custom_fields">,
): string {
  if (lead.first_name || lead.last_name) {
    const first = lead.first_name?.charAt(0)?.toUpperCase() || "";
    const last = lead.last_name?.charAt(0)?.toUpperCase() || "";
    const combined = `${first}${last}`;
    if (combined) return combined;
  }
  const fromCustom = readFullnameCustomField(lead.custom_fields);
  if (fromCustom) {
    const parts = fromCustom.split(/\s+/).filter(Boolean);
    const first = parts[0]?.charAt(0)?.toUpperCase() || "";
    const last = parts.length > 1 ? parts[parts.length - 1].charAt(0).toUpperCase() : "";
    return `${first}${last}` || "?";
  }
  return "?";
}
