// GET   /api/v1/inbox/website-chat — the tenant's website chat state and settings (admin only)
// POST  /api/v1/inbox/website-chat — connect: create the Chatwoot inbox for this tenant (admin only)
// PATCH /api/v1/inbox/website-chat — change settings and/or switch chat on or off (admin only)
//
// Behind INBOX_CHATWOOT_ENABLED like the rest of website chat. The tenant always comes from the
// signed-in session; nothing in the request can point at another tenant.

import { NextRequest } from "next/server";
import { apiSuccess, apiValidationError } from "@/lib/api/response";
import { mergeWebsiteChatSettings, normalizeWebsiteHost } from "@/lib/inbox/website-chat/settings";
import { connectWebsiteChat, loadWebsiteChat, updateWebsiteChat, WebsiteChatError } from "@/lib/inbox/website-chat/service";
import { errorResponse, guard } from "@/lib/inbox/website-chat/route-helpers";

export async function GET() {
  const g = await guard();
  if (!g.ok) return g.response;
  try {
    return apiSuccess(await loadWebsiteChat(g.db.raw(), g.auth.tenantId));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.response;

  const body = (await request.json().catch(() => null)) as { websiteHost?: unknown } | null;
  const websiteHost = typeof body?.websiteHost === "string" ? normalizeWebsiteHost(body.websiteHost) : null;
  if (!websiteHost) return apiValidationError({ websiteHost: ["Enter your website address, for example example.com"] });

  try {
    const { data: tenant } = await g.db.raw().from("tenants").select("name").eq("id", g.auth.tenantId).maybeSingle();
    const state = await connectWebsiteChat({
      db: g.db.raw(),
      tenantId: g.auth.tenantId,
      tenantName: (tenant as { name?: string } | null)?.name?.trim() || "Website",
      userId: g.auth.userId,
      websiteHost,
    });
    return apiSuccess(state, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiValidationError({ body: ["Request body must be a JSON object"] });
  const { enabled, ...settingsInput } = body;
  if (enabled !== undefined && typeof enabled !== "boolean") return apiValidationError({ enabled: ["Must be true or false"] });

  try {
    const current = await loadWebsiteChat(g.db.raw(), g.auth.tenantId);
    if (!current.connected || !current.settings) throw new WebsiteChatError("Website chat is not connected", "not_connected");

    const merged = mergeWebsiteChatSettings(current.settings, settingsInput);
    if (!merged.ok) return apiValidationError(merged.errors);

    return apiSuccess(
      await updateWebsiteChat({
        db: g.db.raw(),
        tenantId: g.auth.tenantId,
        settings: merged.settings,
        enabled: enabled ?? current.enabled,
      })
    );
  } catch (err) {
    return errorResponse(err);
  }
}
