import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { dispatchWebhookEvent } from "@/lib/webhooks/dispatcher";

interface AuditLogInput {
  tenantId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string;
}

export async function createAuditLog(input: AuditLogInput): Promise<void> {
  try {
    const supabase = await createServiceClient();
    const { error } = await supabase.from("audit_logs").insert({
      tenant_id: input.tenantId,
      user_id: input.userId || null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      changes: input.changes || {},
      ip_address: input.ipAddress || null,
      user_agent: input.userAgent || null,
    });

    if (error) {
      logger.error(
        { err: error, requestId: input.requestId, entityId: input.entityId },
        "Failed to create audit log"
      );
    }
  } catch (err) {
    logger.error(
      { err, requestId: input.requestId, entityId: input.entityId },
      "Failed to create audit log"
    );
  }
}

interface EventInput {
  tenantId: string;
  type: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
  requestId?: string;
}

export async function emitEvent(input: EventInput): Promise<string | null> {
  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("events")
      .insert({
        tenant_id: input.tenantId,
        type: input.type,
        entity_type: input.entityType,
        entity_id: input.entityId,
        payload: input.payload || {},
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      logger.error(
        { err: error, requestId: input.requestId, entityId: input.entityId },
        "Failed to emit event"
      );
      return null;
    }

    // Dispatch webhooks non-blocking — never blocks the CRM operation
    dispatchWebhookEvent({
      tenantId: input.tenantId,
      eventType: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      payload: input.payload,
    }).catch((err) => {
      logger.error({ err, eventType: input.type }, "Webhook dispatch error (non-blocking)");
    });

    return data?.id ?? null;
  } catch (err) {
    logger.error(
      { err, requestId: input.requestId, entityId: input.entityId },
      "Failed to emit event"
    );
    return null;
  }
}
