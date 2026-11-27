import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClient } from "@/lib/supabase/scoped";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

function isValidEmail(addr: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
}
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const domainOf = (addr: string) => addr.slice(addr.lastIndexOf("@") + 1).toLowerCase();

const SELECT = "from_name, from_address, reply_to, domain_verified, no_reply_address, template_color, template_accent, template_logo_url, updated_at";

// GET /api/v1/settings/email-sender — return tenant's email sender config
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { data } = await db
    .from("tenant_email_settings")
    .select(SELECT);

  return apiSuccess(
    data?.[0] ?? {
      from_name: null,
      from_address: null,
      reply_to: null,
      domain_verified: false,
      no_reply_address: null,
      template_color: null,
      template_accent: null,
      template_logo_url: null,
      updated_at: null,
    }
  );
}

// PUT /api/v1/settings/email-sender — upsert sender config (admin-only)
export async function PUT(request: NextRequest) {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "PUT",
    path: "/api/v1/settings/email-sender",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const errors: Record<string, string[]> = {};

  const fromName = typeof body.from_name === "string" ? body.from_name.trim() : null;
  const fromAddress = typeof body.from_address === "string" ? body.from_address.trim() : null;
  const replyTo = typeof body.reply_to === "string" ? body.reply_to.trim() : null;

  if (fromAddress && !isValidEmail(fromAddress)) {
    errors.from_address = ["Must be a valid email address"];
  }
  if (replyTo && !isValidEmail(replyTo)) {
    errors.reply_to = ["Must be a valid email address"];
  }

  // The no-reply address and the template colours are optional and only touched when the request carries them, so a client that
  // only knows the original three fields can never wipe them. An empty string clears one.
  const optional = (v: unknown): string | null | undefined => (v === undefined ? undefined : typeof v === "string" ? v.trim() || null : null);
  const noReplyAddress = optional(body.no_reply_address);
  const templateColor = optional(body.template_color);
  const templateAccent = optional(body.template_accent);
  const templateLogoUrl = optional(body.template_logo_url);

  if (noReplyAddress) {
    if (!isValidEmail(noReplyAddress)) {
      errors.no_reply_address = ["Must be a valid email address"];
    } else if (!fromAddress || !isValidEmail(fromAddress)) {
      errors.no_reply_address = ["Set the From address first: the no-reply address must be on the same domain"];
    } else if (domainOf(noReplyAddress) !== domainOf(fromAddress)) {
      errors.no_reply_address = [`Must be on the same domain as the From address (@${domainOf(fromAddress)})`];
    } else if (noReplyAddress.toLowerCase() === fromAddress.toLowerCase()) {
      errors.no_reply_address = ["Must be a different address from the From address"];
    }
  }
  if (templateColor && !HEX_COLOR.test(templateColor)) errors.template_color = ["Use a colour like #0D1282"];
  if (templateAccent && !HEX_COLOR.test(templateAccent)) errors.template_accent = ["Use a colour like #FDED22"];

  if (templateLogoUrl) {
    // The email can only show an image from a public https link. .webp is refused because Outlook does not display it.
    let parsed: URL | null = null;
    try {
      parsed = new URL(templateLogoUrl);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== "https:" || templateLogoUrl.length > 500) {
      errors.template_logo_url = ["Use a public https link to a PNG or JPG image"];
    } else if (/\.webp$/i.test(parsed.pathname)) {
      errors.template_logo_url = ["Use a PNG or JPG: Outlook does not show .webp images"];
    }
  }

  if (Object.keys(errors).length > 0) {
    return apiValidationError(errors);
  }

  // domain_verified is NOT settable through this route — backend/Ops only.
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("tenant_email_settings")
    .upsert(
      {
        tenant_id: auth.tenantId,
        from_name: fromName || null,
        from_address: fromAddress || null,
        reply_to: replyTo || null,
        ...(noReplyAddress !== undefined ? { no_reply_address: noReplyAddress } : {}),
        ...(templateColor !== undefined ? { template_color: templateColor ? templateColor.toUpperCase() : null } : {}),
        ...(templateAccent !== undefined ? { template_accent: templateAccent ? templateAccent.toUpperCase() : null } : {}),
        ...(templateLogoUrl !== undefined ? { template_logo_url: templateLogoUrl } : {}),
        updated_at: new Date().toISOString(),
        updated_by: auth.userId,
      },
      { onConflict: "tenant_id" }
    )
    .select(SELECT)
    .single();

  if (error) {
    log.error({ err: error }, "Failed to upsert tenant_email_settings");
    return apiServiceUnavailable("Failed to save email sender settings");
  }

  log.info({ tenantId: auth.tenantId }, "Tenant email sender settings updated");
  return apiSuccess(data);
}
