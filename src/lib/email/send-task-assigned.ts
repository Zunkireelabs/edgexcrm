import { getResendClient, EMAIL_FROM, APP_URL } from "./index";
import {
  getTaskAssignedEmailTemplate,
  getTaskAssignedEmailSubject,
  getTaskCompletedEmailTemplate,
  getTaskCompletedEmailSubject,
} from "./templates/task-assigned";
import { createRequestLogger } from "@/lib/logger";

// Transactional task emails — a direct clone of ./send-lead-assigned.ts. Fired
// from PATCH /api/v1/tasks/[id] alongside (never instead of) the in-app
// notification. Every failure path returns { success: false } and never
// throws to the caller — email must never fail the API request.

interface SendTaskEmailParams {
  to: string;
  actorEmail: string;
  tenantName: string;
  taskId: string;
  taskTitle: string;
  /** Path (leading slash) the CTA links to, e.g. "/projects/abc" or "/tasks". */
  taskPath: string;
  primaryColor?: string;
}

interface SendEmailResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

function taskLink(taskPath: string): string {
  return `${APP_URL}${taskPath}`;
}

async function send(
  path: "send-task-assigned" | "send-task-completed",
  params: SendTaskEmailParams,
  subject: string,
  html: string,
): Promise<SendEmailResult> {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "EMAIL",
    path,
  });

  const resend = getResendClient();
  if (!resend) {
    log.warn(
      { to: params.to, taskId: params.taskId, tenantName: params.tenantName },
      "Email disabled - RESEND_API_KEY not configured",
    );
    return { success: false, error: "Email not configured" };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: params.to,
      subject,
      html,
    });

    if (error) {
      log.error({ err: error, to: params.to, taskId: params.taskId }, `Failed to send ${path} email`);
      return { success: false, error: error.message };
    }

    log.info({ messageId: data?.id, to: params.to, taskId: params.taskId }, `${path} email sent`);
    return { success: true, messageId: data?.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    log.error({ err, to: params.to, taskId: params.taskId }, `Exception sending ${path} email`);
    return { success: false, error: errorMessage };
  }
}

export async function sendTaskAssignedEmail(params: SendTaskEmailParams): Promise<SendEmailResult> {
  return send(
    "send-task-assigned",
    params,
    getTaskAssignedEmailSubject(params.taskTitle),
    getTaskAssignedEmailTemplate({
      tenantName: params.tenantName,
      actorEmail: params.actorEmail,
      taskTitle: params.taskTitle,
      taskLink: taskLink(params.taskPath),
      primaryColor: params.primaryColor,
    }),
  );
}

export async function sendTaskCompletedEmail(params: SendTaskEmailParams): Promise<SendEmailResult> {
  return send(
    "send-task-completed",
    params,
    getTaskCompletedEmailSubject(params.taskTitle),
    getTaskCompletedEmailTemplate({
      tenantName: params.tenantName,
      actorEmail: params.actorEmail,
      taskTitle: params.taskTitle,
      taskLink: taskLink(params.taskPath),
      primaryColor: params.primaryColor,
    }),
  );
}
