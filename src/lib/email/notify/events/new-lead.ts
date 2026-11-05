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

/** tel: link from a free-typed phone number; null when it has no usable digits. */
function telHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  return /^\+?\d{5,}$/.test(digits) ? `tel:${digits}` : null;
}

/** "5 Nov 2026, 3:17 pm GMT+5:45" — in the workspace's own time zone (UTC if it is missing/invalid). */
function formatReceived(iso: string | null | undefined, timeZone: string): string {
  const d = iso ? new Date(iso) : new Date();
  const date = Number.isNaN(d.getTime()) ? new Date() : d;
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
      timeZone: tz, timeZoneName: "short",
    }).format(date);
  try {
    return fmt(timeZone || "UTC");
  } catch {
    return fmt("UTC");
  }
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
    const fullName = `${payload.firstName ?? ""} ${payload.lastName ?? ""}`.trim();
    // The headline is who arrived: their name, else their email, else a neutral label.
    const display = fullName || payload.email?.trim() || "New lead";
    const { html, text } = renderEmailLayout({
      title: `New lead: ${display}`,
      preheader: `${display} just landed in ${context.listName}`,
      tenantName: tenant.name,
      primaryColor: tenant.primaryColor,
      eyebrow: "New lead received",
      heading: display,
      rows: [
        { label: "Email", value: payload.email, href: payload.email ? `mailto:${payload.email.trim()}` : null },
        { label: "Phone", value: payload.phone, href: telHref(payload.phone) },
        { label: "Stage", value: context.listName },
        { label: "Source", value: payload.source },
        { label: "Received", value: formatReceived(payload.createdAt, tenant.timezone) },
      ],
      cta: { label: "Open lead in EdgeX", url: `${APP_URL}/leads/${payload.leadId}` },
      footer: `You're receiving this because you're an Owner or Admin of ${tenant.name}.`,
    });
    return {
      subject: display === "New lead" ? `New lead received — ${tenant.name}` : `New lead: ${display} — ${tenant.name}`,
      html,
      text,
    };
  },
};
