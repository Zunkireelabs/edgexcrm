import type { Lead } from "@/types/database";
import { renderTemplate } from "@/lib/email/render-template";
import { SAMPLE_VALUES } from "./body-format";

// "Send me a test" for a sequence step: the step as a lead would receive it — merge tags filled with sample data — sent to
// the person editing the sequence, so they can see it in a real inbox before 5,000 leads do. Pure (no I/O): the route
// queues and sends the result through the normal outbound spine (unsubscribe footer, suppression, cap, sandbox).

export const TEST_SUBJECT_PREFIX = "[Test] ";
export const TEST_MAX_SUBJECT = 300;
export const TEST_MAX_BODY = 200_000;

/** The sample lead the preview already uses — so what you see in the editor preview is what the test shows. */
export function sampleLead(email: string): Lead {
  return {
    id: "sample-lead",
    tenant_id: "sample",
    first_name: SAMPLE_VALUES.first_name,
    last_name: SAMPLE_VALUES.last_name,
    email,
    phone: SAMPLE_VALUES.phone,
    city: SAMPLE_VALUES.city,
    country: SAMPLE_VALUES.country,
    custom_fields: {},
  } as Lead;
}

export function validateTestInput(
  subject: unknown,
  body: unknown
): { ok: true; subject: string; body: string } | { ok: false; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  if (typeof subject !== "string" || !subject.trim()) errors.subject_template = ["Add a subject first."];
  else if (subject.length > TEST_MAX_SUBJECT) errors.subject_template = [`The subject is too long (max ${TEST_MAX_SUBJECT} characters).`];
  if (typeof body !== "string" || !body.trim()) errors.body_template = ["Add some text to the email first."];
  else if (body.length > TEST_MAX_BODY) errors.body_template = ["The email is too large to send as a test."];
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, subject: subject as string, body: body as string };
}

/** Subject + HTML body for the test: sample data, a "[Test]" subject, and a small note so nobody mistakes it for a real send. */
export function buildTestEmail(params: { subject: string; body: string; tenantName: string; toEmail: string; stepLabel?: string }) {
  const ctx = { lead: sampleLead(params.toEmail), tenant: { name: params.tenantName } };
  const note =
    `<p style="margin:0 0 16px;padding:8px 12px;background:#f3f4f6;border-radius:6px;font:12px/1.4 Arial,sans-serif;color:#555">` +
    `This is a test${params.stepLabel ? ` of ${escapeHtml(params.stepLabel)}` : ""}. Merge tags use sample data (Jane Doe); a real lead sees their own details.` +
    `</p>`;
  return {
    subject: TEST_SUBJECT_PREFIX + renderTemplate(params.subject, ctx),
    body_html: note + renderTemplate(params.body, ctx),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
