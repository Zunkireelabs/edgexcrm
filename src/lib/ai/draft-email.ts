import { generateObject } from "ai";
import { z } from "zod";
import { model } from "./provider";
import { MODELS, ACTIVE_PROVIDER } from "./models";
import { checkDailyBudget } from "./budget";
import { startTrace } from "./telemetry";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import type { LeadTemplateContext } from "@/industries/_shared/features/outreach/lib/engine";

export interface DraftEmailInput {
  tenantId: string;
  tenantName: string;
  lead: LeadTemplateContext;
  sequence: { name: string; description: string | null };
  step: { stepOrder: number; totalSteps: number; instructions: string | null };
}

export interface DraftEmailResult {
  subject: string;
  body_html: string;
}

/** Thrown when the tenant's daily AI output-token budget (budget.ts) is exhausted. Callers fall back to template. */
export class DraftBudgetExceededError extends Error {
  constructor() {
    super("Daily AI output-token budget exceeded for this tenant");
    this.name = "DraftBudgetExceededError";
  }
}

const draftSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body_html: z
    .string()
    .trim()
    .min(1)
    .describe("Email body as simple HTML using only <p>, <br>, and <a> tags — no scripts, no styles, no other tags."),
});

const ALLOWED_TAGS = new Set(["p", "br", "a", "strong", "em", "ul", "ol", "li", "b", "i"]);

// Strips anything outside a small allow-list of formatting tags (and neutralizes
// unsafe href schemes) — the model is instructed to return plain formatting HTML,
// but instructions are not a security boundary, so the output is sanitized here too.
function sanitizeBodyHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?([a-z][a-z0-9]*)([^>]*)>/gi, (match, rawTag: string, attrs: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return "";
      if (match.startsWith("</")) return `</${tag}>`;
      if (tag === "a") {
        const hrefMatch = attrs.match(/href\s*=\s*"([^"]*)"/i) ?? attrs.match(/href\s*=\s*'([^']*)'/i);
        const href = (hrefMatch?.[1] ?? "").trim();
        const safeHref = /^(https?:|mailto:)/i.test(href) ? href : "#";
        return `<a href="${safeHref}">`;
      }
      return `<${tag}>`;
    })
    .trim();
}

function leadContextLines(lead: LeadTemplateContext): string {
  const lines: string[] = [];
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
  if (name) lines.push(`Name: ${name}`);
  if (lead.email) lines.push(`Email: ${lead.email}`);
  const location = [lead.city, lead.country].filter(Boolean).join(", ");
  if (location) lines.push(`Location: ${location}`);
  if (lead.custom_fields && Object.keys(lead.custom_fields).length > 0) {
    lines.push(`Additional details: ${JSON.stringify(lead.custom_fields)}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(no additional details on file)";
}

/**
 * The shared AI drafter for outreach sequence emails — used by both fire-time
 * auto-AI steps (engine.ts) and the on-demand "Draft with AI" button
 * (drafts/[id]/regenerate). Callers MUST have already checked
 * isOutreachDraftEnabledForTenant — this function does not re-check the D5
 * gate, only the per-tenant daily budget.
 */
export async function draftSequenceEmail(input: DraftEmailInput): Promise<DraftEmailResult> {
  const { tenantId, tenantName, lead, sequence, step } = input;
  const db = await scopedClientForTenant(tenantId);

  const budget = await checkDailyBudget(db, tenantId);
  if (budget.overBudget) throw new DraftBudgetExceededError();

  const runId = crypto.randomUUID();
  // surface composes into telemetry.ts's trace name as "assistant.outreach.draft" —
  // that file's naming convention, reused as-is rather than inventing a new shape.
  const trace = startTrace({ runId, tenantId, industryId: null, surface: "outreach.draft" });
  trace.span("draft.start", { tenantId, sequenceName: sequence.name, stepOrder: step.stepOrder, totalSteps: step.totalSteps });

  const systemPrompt =
    `Write ONE email in a multi-step outreach cadence for ${tenantName}. ` +
    `This is step ${step.stepOrder} of ${step.totalSteps} in the "${sequence.name}" sequence` +
    (sequence.description ? ` (goal: ${sequence.description})` : "") +
    `. Keep it concise, warm, and professional. Return only a subject line and an HTML body using ` +
    `<p> and <br> tags for structure and <a> for links only — no scripts, no styles, no other tags.` +
    (step.instructions ? ` Sender's instructions for this step: ${step.instructions}` : "");

  const prompt = `Lead details:\n${leadContextLines(lead)}`;

  try {
    const { object, usage } = await generateObject({
      model: model("agent"),
      schema: draftSchema,
      system: systemPrompt,
      prompt,
      maxRetries: 1,
    });

    await db.from("ai_usage_events").insert({
      run_id: runId,
      model: MODELS[ACTIVE_PROVIDER].agent,
      input_tokens: usage.inputTokens ?? null,
      output_tokens: usage.outputTokens ?? null,
      tool_calls: 0,
      // budget.ts's checkDailyBudget hardcodes surface:'assistant' — reusing
      // that value (rather than a new one) is what makes this draft's tokens
      // actually count against the tenant's daily budget check above.
      surface: "assistant",
    });

    trace.end({ ok: true, model: MODELS[ACTIVE_PROVIDER].agent, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });

    return { subject: object.subject.trim(), body_html: sanitizeBodyHtml(object.body_html) };
  } catch (err) {
    trace.end({ ok: false });
    throw err;
  }
}
