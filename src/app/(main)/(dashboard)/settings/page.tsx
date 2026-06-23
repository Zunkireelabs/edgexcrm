/**
 * Settings page — opener redirect.
 *
 * This page no longer renders settings inline. Instead it redirects to the
 * current dashboard page with ?settings=<tab> so the global SettingsModal
 * opens over whatever page the user was on.
 *
 * Bookmarks and OAuth callbacks that land on /settings?tab=X or /settings?connected=X
 * are mapped to the correct modal tab and forwarded to /home.
 */
import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";

/** Map old ?tab= values (or anchor keys) to new modal tab keys. */
const TAB_MAP: Record<string, string> = {
  general: "general",
  organization: "organization",
  team: "team-roles",
  "team-roles": "team-roles",
  leads: "lead-management",
  "lead-management": "lead-management",
  "lead-lists": "lead-management",
  academic: "academic-operations",
  "academic-operations": "academic-operations",
  classes: "academic-operations",
  communications: "communications",
  inbox: "communications",
  "connected-inboxes": "communications",
  integrations: "integrations",
  compliance: "compliance",
  "ai-orca": "ai-orca",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  if (tenantData.role !== "owner" && tenantData.role !== "admin") {
    redirect("/home");
  }

  const params = await searchParams;

  // Determine which tab to open
  const rawTab = params.tab ?? params.settings ?? null;
  const tab = (rawTab && TAB_MAP[rawTab]) ?? "general";

  // Forward connected/error params (from Gmail OAuth callback) into the modal URL
  const forwardParams = new URLSearchParams();
  forwardParams.set("settings", tab);
  if (params.connected) forwardParams.set("connected", params.connected);
  if (params.error) forwardParams.set("error", params.error);

  redirect(`/home?${forwardParams.toString()}`);
}
