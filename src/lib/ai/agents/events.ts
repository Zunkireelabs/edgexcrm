import { inngest } from "@/lib/inngest/client";
import { isAgentsEnabled } from "@/lib/ai/flag";
import { logger } from "@/lib/logger";

interface DomainEventInput {
  tenantId: string;
  type: string;
  entityType: string;
  entityId: string;
}

/**
 * CRM -> Inngest event plumbing (doc 03 §2). Fans the same central dispatch
 * point (emitEvent in src/lib/api/audit.ts) that already drives webhooks into
 * the agent runner, one event at a time, IDs only — no tenant content (ADR-001
 * D5): the future consumer fetches the row itself inside its handler. Gated on
 * the env flag alone so nothing is sent, and no Inngest quota spent, until
 * agents are turned on anywhere; ships no consumer yet (5.1b).
 */
export async function emitDomainEvent(input: DomainEventInput): Promise<void> {
  if (!isAgentsEnabled()) return;

  try {
    await inngest.send({
      name: `crm/${input.type}`,
      data: {
        tenantId: input.tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });
  } catch (err) {
    logger.error({ err, eventType: input.type }, "Domain event emission error (non-blocking)");
  }
}
