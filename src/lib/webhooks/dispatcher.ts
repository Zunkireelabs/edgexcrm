import { createHmac } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import {
  buildLookupMaps,
  normalizeLead,
  type NormalizedLead,
} from "@/lib/api/integration-helpers";
import { logger } from "@/lib/logger";
import type { Lead } from "@/types/database";

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [0, 2000, 5000]; // immediate, 2s, 5s
const DELIVERY_TIMEOUT_MS = 10000; // 10s per attempt

interface WebhookEndpoint {
  id: string;
  tenant_id: string;
  url: string;
  secret: string;
  event_types: string[];
}

interface WebhookEventInput {
  tenantId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
}

/**
 * Sign a payload string with HMAC-SHA256.
 */
function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dispatch webhook event to all matching endpoints for a tenant.
 * This function NEVER throws — webhook failures must not block CRM operations.
 */
export async function dispatchWebhookEvent(
  input: WebhookEventInput
): Promise<void> {
  try {
    const supabase = await createServiceClient();

    // Fetch active webhook endpoints that subscribe to this event type
    const { data: endpoints, error: fetchError } = await supabase
      .from("webhook_endpoints")
      .select("id, tenant_id, url, secret, event_types")
      .eq("tenant_id", input.tenantId)
      .eq("is_active", true)
      .contains("event_types", [input.eventType]);

    if (fetchError || !endpoints || endpoints.length === 0) {
      return; // No webhooks configured — silent exit
    }

    // Build normalized lead snapshot if entity is a lead
    let normalizedLead: NormalizedLead | null = null;
    if (input.entityType === "lead") {
      normalizedLead = await buildLeadSnapshot(
        supabase,
        input.tenantId,
        input.entityId
      );
    }

    // Build the webhook payload — NEVER expose tenant_id, integration_key_id, or internal DB IDs
    const sanitizedPayload = { ...input.payload };
    delete sanitizedPayload.tenant_id;
    delete sanitizedPayload.integration_key_id;

    const webhookPayload = {
      event: input.eventType,
      timestamp: new Date().toISOString(),
      data: {
        ...(normalizedLead ? { lead: normalizedLead } : {}),
        ...sanitizedPayload,
        entity_type: input.entityType,
        entity_id: input.entityId,
      },
    };

    const payloadString = JSON.stringify(webhookPayload);

    // Dispatch to all matching endpoints concurrently
    await Promise.allSettled(
      endpoints.map((endpoint) =>
        deliverToEndpoint(supabase, endpoint as WebhookEndpoint, input.eventType, payloadString)
      )
    );
  } catch (err) {
    // Never throw from webhook dispatch
    logger.error(
      { err, tenantId: input.tenantId, eventType: input.eventType },
      "Webhook dispatch failed"
    );
  }
}

/**
 * Deliver a webhook payload to a single endpoint with retries.
 */
async function deliverToEndpoint(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  endpoint: WebhookEndpoint,
  eventType: string,
  payloadString: string
): Promise<void> {
  const signature = signPayload(payloadString, endpoint.secret);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt - 1] || 0;
    if (delay > 0) {
      await sleep(delay);
    }

    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let success = false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": `sha256=${signature}`,
          "X-Webhook-Event": eventType,
          "User-Agent": "LeadGenCRM-Webhook/1.0",
        },
        body: payloadString,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      statusCode = response.status;
      responseBody = await response.text().catch(() => null);
      success = response.ok; // 2xx
    } catch (err) {
      statusCode = 0;
      responseBody =
        err instanceof Error ? err.message : "Unknown delivery error";
    }

    // Log the delivery attempt
    await logDelivery(supabase, {
      webhookId: endpoint.id,
      eventType,
      payload: payloadString,
      attempt,
      statusCode,
      responseBody,
      success,
    });

    if (success) {
      logger.info(
        {
          webhookId: endpoint.id,
          eventType,
          attempt,
          statusCode,
        },
        "Webhook delivered successfully"
      );
      return; // Success — stop retrying
    }

    logger.warn(
      {
        webhookId: endpoint.id,
        eventType,
        attempt,
        statusCode,
        maxAttempts: MAX_ATTEMPTS,
      },
      `Webhook delivery attempt ${attempt}/${MAX_ATTEMPTS} failed`
    );
  }

  // All attempts exhausted
  logger.error(
    {
      webhookId: endpoint.id,
      eventType,
      url: endpoint.url,
    },
    "Webhook delivery failed after all retries"
  );
}

/**
 * Log a webhook delivery attempt to the database.
 */
async function logDelivery(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  input: {
    webhookId: string;
    eventType: string;
    payload: string;
    attempt: number;
    statusCode: number | null;
    responseBody: string | null;
    success: boolean;
  }
): Promise<void> {
  try {
    const { error } = await supabase.from("webhook_deliveries").insert({
      webhook_id: input.webhookId,
      event_type: input.eventType,
      payload: JSON.parse(input.payload),
      attempt: input.attempt,
      status_code: input.statusCode,
      response_body: input.responseBody?.substring(0, 2000) || null, // Truncate
      success: input.success,
    });

    if (error) {
      logger.error({ err: error, webhookId: input.webhookId }, "Failed to log webhook delivery");
    }
  } catch (err) {
    logger.error({ err, webhookId: input.webhookId }, "Failed to log webhook delivery");
  }
}

/**
 * Fetch and normalize a lead for the webhook payload snapshot.
 */
async function buildLeadSnapshot(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  leadId: string
): Promise<NormalizedLead | null> {
  try {
    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("tenant_id", tenantId)
      .single();

    if (!lead) return null;

    const { stageMap, userMap } = await buildLookupMaps(supabase, tenantId);
    return normalizeLead(lead as Lead, stageMap, userMap);
  } catch {
    return null;
  }
}
