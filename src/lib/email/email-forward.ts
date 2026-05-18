import { createServiceClient } from "@/lib/supabase/server";
import { getResendClient, EMAIL_FROM } from "./index";
import { interpolateTemplate } from "./smtp-sender";
import { createRequestLogger } from "@/lib/logger";
import type { Lead } from "@/types/database";

interface ProcessEmailForwardParams {
  tenantId: string;
  lead: Lead;
  newStageId: string;
}

/**
 * Check for active email forward rules matching the new stage,
 * and send emails to the lead for each matching rule via Resend.
 * This is called fire-and-forget after a stage change.
 */
export async function processEmailForwardRules({
  tenantId,
  lead,
  newStageId,
}: ProcessEmailForwardParams): Promise<void> {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "EMAIL_FORWARD",
    path: "process-rules",
  });

  if (!lead.email) {
    log.info({ leadId: lead.id }, "Lead has no email, skipping email forward");
    return;
  }

  const resend = getResendClient();
  if (!resend) {
    log.warn("Resend not configured, skipping email forward");
    return;
  }

  try {
    const supabase = await createServiceClient();

    // Find active rules matching this tenant + stage
    const { data: rules, error } = await supabase
      .from("email_forward_rules")
      .select(`
        *,
        pipelines!inner(name),
        pipeline_stages!inner(name)
      `)
      .eq("tenant_id", tenantId)
      .eq("stage_id", newStageId)
      .eq("is_active", true);

    if (error) {
      log.error({ err: error }, "Failed to fetch email forward rules");
      return;
    }

    if (!rules || rules.length === 0) {
      return;
    }

    // Get tenant name for template
    const { data: tenant } = await supabase
      .from("tenants")
      .select("name")
      .eq("id", tenantId)
      .single();

    const templateVars: Record<string, string> = {
      first_name: lead.first_name || "",
      last_name: lead.last_name || "",
      email: lead.email || "",
      phone: lead.phone || "",
      tenant_name: tenant?.name || "",
      pipeline_name: "",
      stage_name: "",
    };

    log.info(
      { leadId: lead.id, stageId: newStageId, ruleCount: rules.length },
      "Processing email forward rules"
    );

    for (const rule of rules) {
      const pipelineName = (rule.pipelines as { name: string })?.name || "";
      const stageName = (rule.pipeline_stages as { name: string })?.name || "";

      const vars = {
        ...templateVars,
        pipeline_name: pipelineName,
        stage_name: stageName,
      };

      const subject = interpolateTemplate(rule.subject, vars);
      const body = interpolateTemplate(rule.body, vars);

      // Use custom from name if set, otherwise system default
      const fromAddress = rule.from_name
        ? `${rule.from_name} <noreply@lead-crm.zunkireelabs.com>`
        : EMAIL_FROM;

      try {
        const { data, error: sendError } = await resend.emails.send({
          from: fromAddress,
          to: lead.email!,
          subject,
          html: body,
        });

        if (sendError) {
          log.error(
            { ruleId: rule.id, ruleName: rule.name, leadId: lead.id, err: sendError },
            "Email forward failed"
          );
        } else {
          log.info(
            { ruleId: rule.id, ruleName: rule.name, leadId: lead.id, messageId: data?.id },
            "Email forward sent"
          );
        }
      } catch (err) {
        log.error(
          { ruleId: rule.id, ruleName: rule.name, leadId: lead.id, err },
          "Email forward exception"
        );
      }
    }
  } catch (err) {
    log.error({ err, leadId: lead.id }, "Exception in email forward processing");
  }
}
