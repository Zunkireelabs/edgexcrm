import { INDUSTRIES } from "@/industries/_registry";

// Round 1 (docs/IT-AGENCY-DISPATCH-LOOP-BRIEF.md §2 Slice B) asked for a single
// tenant-level switch, default ON for it_agency, OFF elsewhere. There is no
// `tenant_settings`-shaped home in the schema today, and adding one would mean a
// migration — the brief says use a feature-flag constant instead and say so in
// the report. So the switch is: the industry gate, plus an env kill-switch that
// only ever turns it OFF (TASK_NOTIFICATION_EMAIL_DISABLED=true), never on for a
// non-it_agency tenant. Promote to a real per-tenant/per-user preference when a
// second tenant asks (adoption plan §3, Round 1 decisions).
export function isTaskEmailEnabled(industryId: string | null | undefined): boolean {
  if (industryId !== INDUSTRIES.IT_AGENCY) return false;
  return process.env.TASK_NOTIFICATION_EMAIL_DISABLED !== "true";
}
