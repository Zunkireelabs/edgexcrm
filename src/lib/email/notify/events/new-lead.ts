import { APP_URL } from "../../index";
import { renderEmailLayout } from "../base-layout";
import type { NotificationEmailEvent } from "../types";

/**
 * "A new lead landed in the New Lead stage" — emailed to every Owner/Admin of the workspace.
 * "New Lead stage" = the tenant's intake list (lead_lists.is_intake = true).
 *
 * The caller passes plain data only (no request/route types). Call it ONLY from a path that just created a brand-new
 * lead (never from dedupe / merge / update paths) — the ledger makes an accidental double call harmless, but the
 * intent is one call per created lead.
 */
export interface NewLeadAlertPayload {
  tenantId: string;
  leadId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Human-readable source: form name, "API", "Manual"… */
  source?: string | null;
  /** The list the lead was created in (null = no stage). */
  listId: string | null;
  /** Partial (in-progress form) leads never notify. */
  isFinal: boolean;
  /**
   * Leads from external integrations are created with no stage yet. Set true to treat "no stage" as "New Lead"
   * for them (ticket: "any source"). Never set it for a path that can legitimately create a staged lead elsewhere.
   */
  treatNoStageAsNew?: boolean;
  createdAt?: string | null;
}

interface NewLeadContext {
  listName: string;
}

const DEFAULT_LIST_NAME = "New Leads";

function formatReceived(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const date = Number.isNaN(d.getTime()) ? new Date() : d;
  return `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}

export const newLeadEvent: NotificationEmailEvent<NewLeadAlertPayload, NewLeadContext> = {
  id: "new_lead",
  roles: ["owner", "admin"],
  tenantId: (p) => p.tenantId,
  entityId: (p) => p.leadId,

  async prepare(p, db) {
    if (!p.isFinal) return null;

    if (!p.listId) {
      return p.treatNoStageAsNew ? { listName: DEFAULT_LIST_NAME } : null;
    }
    const { data } = await db
      .from("lead_lists")
      .select("name, is_intake")
      .eq("id", p.listId)
      .eq("tenant_id", p.tenantId)
      .maybeSingle();
    const list = data as { name: string | null; is_intake: boolean } | null;
    if (!list?.is_intake) return null; // landed in some other stage — not a New Lead
    return { listName: list.name?.trim() || DEFAULT_LIST_NAME };
  },

  build({ payload, context, tenant }) {
    const name = `${payload.firstName ?? ""} ${payload.lastName ?? ""}`.trim() || "A new lead";
    const { html, text } = renderEmailLayout({
      title: `New lead: ${name}`,
      preheader: `${name} just landed in ${context.listName}`,
      tenantName: tenant.name,
      primaryColor: tenant.primaryColor,
      heading: `New lead in ${context.listName}`,
      intro: "A new lead just arrived.",
      rows: [
        { label: "Name", value: name === "A new lead" ? null : name },
        { label: "Email", value: payload.email },
        { label: "Phone", value: payload.phone },
        { label: "Source", value: payload.source },
        { label: "Received", value: formatReceived(payload.createdAt) },
      ],
      cta: { label: "Open lead in EdgeX", url: `${APP_URL}/leads/${payload.leadId}` },
      footer: `You're receiving this because you're an Owner or Admin of ${tenant.name}.`,
    });
    return { subject: `New lead: ${name} — ${tenant.name}`, html, text };
  },
};
