// GET  /api/v1/inbox/channels — list tenant's inbox channels (token masked, never returned in full)
// POST /api/v1/inbox/channels — connect a new channel (admin only; token encrypted at rest)

import { NextRequest } from "next/server";
import { createHmac } from "crypto";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiSuccess,
  apiConflict,
  apiValidationError,
  apiInternalError,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { encryptToken } from "@/lib/inbox/crypto";

function webhookUrl(provider: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  return `${base}/api/webhooks/meta/${provider}`;
}

function maskToken(token: string | null): string {
  if (!token) return "••••";
  // Show last 4 chars of the *encrypted* blob (not the plaintext)
  return `••••${token.slice(-4)}`;
}

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("inbox_channels")
    .select("id, provider, external_account_id, display_name, status, access_token, webhook_verify_token_hash, created_at, updated_at")
    .order("created_at", { ascending: true });

  if (error) return apiInternalError();

  const rows = (data ?? []).map((ch) => {
    const row = ch as unknown as {
      id: string;
      provider: string;
      external_account_id: string;
      display_name: string;
      status: string;
      access_token: string | null;
      webhook_verify_token_hash: string | null;
      created_at: string;
      updated_at: string;
    };
    return {
      id: row.id,
      provider: row.provider,
      external_account_id: row.external_account_id,
      display_name: row.display_name,
      status: row.status,
      access_token_masked: maskToken(row.access_token),
      webhook_url: webhookUrl(row.provider),
      verify_token: process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });

  return apiSuccess(rows);
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON"] });
  }

  const b = body as Record<string, unknown>;
  const provider = typeof b.provider === "string" ? b.provider.trim() : "";
  const externalAccountId = typeof b.external_account_id === "string" ? b.external_account_id.trim() : "";
  const accessToken = typeof b.access_token === "string" ? b.access_token.trim() : "";
  const displayName = typeof b.display_name === "string" ? b.display_name.trim() : "";

  const errors: Record<string, string[]> = {};
  if (!provider) errors.provider = ["Required"];
  if (provider && !["whatsapp"].includes(provider)) errors.provider = ["Unsupported provider — only 'whatsapp' is supported in this release"];
  if (!externalAccountId) errors.external_account_id = ["Required"];
  if (!accessToken) errors.access_token = ["Required"];
  if (!displayName) errors.display_name = ["Required"];
  if (Object.keys(errors).length > 0) return apiValidationError(errors);

  // Encrypt the token at rest
  let encryptedToken: string;
  try {
    encryptedToken = encryptToken(accessToken);
  } catch {
    return apiInternalError();
  }

  // Generate a per-channel verify-token hash (SHA-256 of a random salt + tenant) so
  // each channel can have a unique verify token. Here we reuse the global
  // META_WEBHOOK_VERIFY_TOKEN — it's set once per env and shown to the admin.
  // The hash stored on the row is used by the sandbox pattern; for Meta channels
  // the webhook verify check uses the env var directly.
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
  const verifyTokenHash = verifyToken
    ? createHmac("sha256", "").update(verifyToken).digest("hex")
    : null;

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("inbox_channels")
    .insert({
      provider,
      external_account_id: externalAccountId,
      display_name: displayName,
      status: "active",
      access_token: encryptedToken,
      webhook_verify_token_hash: verifyTokenHash,
      connected_by_user_id: auth.userId,
    })
    .select("id, provider, external_account_id, display_name, status, created_at")
    .single();

  if (error) {
    // Postgres unique violation: (provider, external_account_id) already exists
    if (error.code === "23505") {
      return apiConflict("This phone number ID is already connected to a channel. Each number can only be connected once.");
    }
    return apiInternalError();
  }

  const row = data as {
    id: string;
    provider: string;
    external_account_id: string;
    display_name: string;
    status: string;
    created_at: string;
  };

  return apiSuccess({
    channel: {
      id: row.id,
      provider: row.provider,
      external_account_id: row.external_account_id,
      display_name: row.display_name,
      status: row.status,
      created_at: row.created_at,
    },
    webhook_url: webhookUrl(provider),
    verify_token: verifyToken,
  }, 201);
}
