import { validateStepSendTime } from "./send-window";
import type { OutreachChannel } from "./channel";

// An SMS step is plain text; this is a sanity cap on the template (well above 6 segments), not a billing limit.
export const SMS_BODY_TEMPLATE_MAX = 1000;

export interface SequenceStepInput {
  step_order: number;
  delay_days?: number;
  send_time?: string | null;
  subject_template?: string;
  body_template?: string;
  draft_source?: "template" | "ai";
  ai_instructions?: string | null;
}

/** Shared shape check for sequence step arrays on both create (POST) and edit (PATCH). */
export function validateSequenceSteps(steps: unknown, channel: OutreachChannel = "email"): string | null {
  if (!Array.isArray(steps) || steps.length === 0) return "steps must be a non-empty array";
  const orders = new Set<number>();
  for (const s of steps as SequenceStepInput[]) {
    if (typeof s.step_order !== "number" || !Number.isInteger(s.step_order) || s.step_order < 1) {
      return "each step needs a positive integer step_order";
    }
    if (orders.has(s.step_order)) return "step_order must be unique per sequence";
    orders.add(s.step_order);
    if (
      s.delay_days !== undefined &&
      (typeof s.delay_days !== "number" || !Number.isInteger(s.delay_days) || s.delay_days < 0)
    ) {
      return "delay_days must be a non-negative integer";
    }
    if (channel === "sms") {
      if (s.subject_template?.trim()) return "SMS steps have no subject";
      // An empty text would go out as just the sender name and the opt-out link.
      if (!(s.body_template ?? "").trim()) return "Every SMS step needs a message";
      if ((s.body_template ?? "").length > SMS_BODY_TEMPLATE_MAX) {
        return `SMS message must be ${SMS_BODY_TEMPLATE_MAX} characters or fewer`;
      }
    }
    const time = validateStepSendTime(s.send_time);
    if (!time.ok) return time.error;
    if (s.draft_source !== undefined && s.draft_source !== "template" && s.draft_source !== "ai") {
      return "draft_source must be 'template' or 'ai'";
    }
    if (s.draft_source === "ai" && !s.ai_instructions?.trim()) {
      return "ai_instructions is required when draft_source is 'ai'";
    }
  }
  if (!orders.has(1)) return "steps must start at step_order 1";
  return null;
}
