// Maps a pathname to the human-readable label shown on the Lead Detail
// page's back button (e.g. "← Applications"). Order matters — first match
// wins, so more specific routes must come before broader ones.
const ROUTE_LABELS: { test: (path: string) => boolean; label: string }[] = [
  { test: (p) => p.startsWith("/leads-organise"), label: "Leads Organise" },
  { test: (p) => p === "/leads" || p.startsWith("/leads?"), label: "All Leads" },
  { test: (p) => p.startsWith("/pipeline"), label: "Pipeline" },
  { test: (p) => p.startsWith("/applications"), label: "Applications" },
  { test: (p) => p.startsWith("/check-in"), label: "Check-In" },
  { test: (p) => p.startsWith("/classes"), label: "Classes" },
  { test: (p) => p.startsWith("/contacts"), label: "Contacts" },
  { test: (p) => p.startsWith("/accounts"), label: "Accounts" },
  { test: (p) => p.startsWith("/inbox"), label: "Inbox" },
  { test: (p) => p.startsWith("/itineraries"), label: "Itineraries" },
  { test: (p) => p.startsWith("/home"), label: "Home" },
];

export const DEFAULT_LEADS_BACK_DESTINATION = { href: "/leads", label: "All Leads" };

export function labelForPath(path: string): string {
  return ROUTE_LABELS.find((r) => r.test(path))?.label ?? "Back";
}
