// Transactional task emails — cloned from ./lead-assigned.ts (the proven
// Resend transactional pattern). Two events only: a task assigned to someone
// other than the actor, and a task reaching "done" (notifies whoever assigned
// it). Deliberately NOT built on src/lib/email/outbound/* — that stack is the
// marketing-blast path (audience/cap/suppression/unsubscribe) and is the wrong
// shape for a one-recipient transactional send.

interface TaskEmailTemplateParams {
  tenantName: string;
  actorEmail: string;
  taskTitle: string;
  taskLink: string;
  primaryColor?: string;
}

function shell({
  tenantName,
  heading,
  bodyLine,
  taskTitle,
  taskLink,
  ctaLabel,
  primaryColor = "#2272B4",
}: {
  tenantName: string;
  heading: string;
  bodyLine: string;
  taskTitle: string;
  taskLink: string;
  ctaLabel: string;
  primaryColor?: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="padding: 32px 40px; border-bottom: 1px solid #eee;">
              <div style="display: inline-block; width: 40px; height: 40px; background-color: ${primaryColor}; border-radius: 8px; text-align: center; line-height: 40px; color: white; font-weight: bold; font-size: 18px;">
                ${tenantName.charAt(0).toUpperCase()}
              </div>
              <span style="margin-left: 12px; font-size: 18px; font-weight: 600; color: #111; vertical-align: middle;">
                ${tenantName}
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding: 48px 40px;">
              <h1 style="margin: 0 0 24px 0; font-size: 24px; font-weight: 600; color: #111;">
                ${heading}
              </h1>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 32px 0; background-color: #f8f9fa; border-radius: 8px; border: 1px solid #eee;">
                <tr>
                  <td style="padding: 24px;">
                    <p style="margin: 0; font-size: 20px; font-weight: 600; color: #111;">
                      ${taskTitle}
                    </p>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 32px 0; font-size: 15px; line-height: 24px; color: #555;">
                ${bodyLine}
              </p>
              <table cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td style="background-color: ${primaryColor}; border-radius: 8px;">
                    <a href="${taskLink}" style="display: inline-block; padding: 14px 32px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none;">
                      ${ctaLabel}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 13px; color: #aaa; line-height: 20px;">
                If you can't click the button, copy and paste this link into your browser:<br>
                <a href="${taskLink}" style="color: ${primaryColor}; word-break: break-all;">${taskLink}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; background-color: #fafafa; border-top: 1px solid #eee;">
              <p style="margin: 0; font-size: 12px; color: #aaa;">
                &copy; ${new Date().getFullYear()} EdgeX by Zunkiree Labs
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

export function getTaskAssignedEmailTemplate({
  tenantName,
  actorEmail,
  taskTitle,
  taskLink,
  primaryColor,
}: TaskEmailTemplateParams): string {
  return shell({
    tenantName,
    heading: "New task assigned to you",
    bodyLine: `Assigned by <strong>${actorEmail}</strong>`,
    taskTitle,
    taskLink,
    ctaLabel: "View Task",
    primaryColor,
  });
}

export function getTaskAssignedEmailSubject(taskTitle: string): string {
  return `New task assigned: ${taskTitle}`;
}

export function getTaskCompletedEmailTemplate({
  tenantName,
  actorEmail,
  taskTitle,
  taskLink,
  primaryColor,
}: TaskEmailTemplateParams): string {
  return shell({
    tenantName,
    heading: "Task completed",
    bodyLine: `Marked done by <strong>${actorEmail}</strong>`,
    taskTitle,
    taskLink,
    ctaLabel: "View Task",
    primaryColor,
  });
}

export function getTaskCompletedEmailSubject(taskTitle: string): string {
  return `Task completed: ${taskTitle}`;
}
