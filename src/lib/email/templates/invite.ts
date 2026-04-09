interface InviteEmailTemplateParams {
  tenantName: string;
  inviterEmail: string;
  role: string;
  inviteLink: string;
  primaryColor?: string;
}

export function getInviteEmailTemplate({
  tenantName,
  inviterEmail,
  role,
  inviteLink,
  primaryColor = "#2272B4",
}: InviteEmailTemplateParams): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You've been invited to join ${tenantName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 40px; border-bottom: 1px solid #eee;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="display: inline-block; width: 40px; height: 40px; background-color: ${primaryColor}; border-radius: 8px; text-align: center; line-height: 40px; color: white; font-weight: bold; font-size: 18px;">
                      ${tenantName.charAt(0).toUpperCase()}
                    </div>
                    <span style="margin-left: 12px; font-size: 18px; font-weight: 600; color: #111; vertical-align: middle;">
                      ${tenantName}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 48px 40px;">
              <h1 style="margin: 0 0 16px 0; font-size: 24px; font-weight: 600; color: #111;">
                You've been invited to join
              </h1>
              <p style="margin: 0 0 32px 0; font-size: 28px; font-weight: 700; color: ${primaryColor};">
                ${tenantName}
              </p>

              <p style="margin: 0 0 32px 0; font-size: 16px; line-height: 24px; color: #555;">
                <strong>${inviterEmail}</strong> invited you to join as <strong style="text-transform: capitalize;">${role}</strong> on the Lead Gen CRM platform.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin: 0 0 32px 0;">
                <tr>
                  <td style="background-color: ${primaryColor}; border-radius: 8px;">
                    <a href="${inviteLink}" style="display: inline-block; padding: 14px 32px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 24px 0; font-size: 14px; color: #888;">
                This invitation will expire in <strong>7 days</strong>.
              </p>

              <p style="margin: 0; font-size: 13px; color: #aaa; line-height: 20px;">
                If you can't click the button, copy and paste this link into your browser:<br>
                <a href="${inviteLink}" style="color: ${primaryColor}; word-break: break-all;">${inviteLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafafa; border-top: 1px solid #eee;">
              <p style="margin: 0 0 8px 0; font-size: 13px; color: #888;">
                If you didn't expect this invitation, you can safely ignore this email.
              </p>
              <p style="margin: 0; font-size: 12px; color: #aaa;">
                &copy; ${new Date().getFullYear()} Lead Gen CRM by Zunkiree Labs
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

export function getInviteEmailSubject(tenantName: string): string {
  return `You've been invited to join ${tenantName}`;
}
