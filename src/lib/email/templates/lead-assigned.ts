interface LeadAssignedEmailTemplateParams {
  tenantName: string;
  assignerEmail: string;
  leadName: string;
  leadEmail?: string;
  leadLink: string;
  primaryColor?: string;
}

export function getLeadAssignedEmailTemplate({
  tenantName,
  assignerEmail,
  leadName,
  leadEmail,
  leadLink,
  primaryColor = "#2272B4",
}: LeadAssignedEmailTemplateParams): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New lead assigned to you</title>
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
              <h1 style="margin: 0 0 24px 0; font-size: 24px; font-weight: 600; color: #111;">
                New lead assigned to you
              </h1>

              <!-- Lead Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 32px 0; background-color: #f8f9fa; border-radius: 8px; border: 1px solid #eee;">
                <tr>
                  <td style="padding: 24px;">
                    <p style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #111;">
                      ${leadName}
                    </p>
                    ${leadEmail ? `
                    <p style="margin: 0; font-size: 14px; color: #666;">
                      ${leadEmail}
                    </p>
                    ` : ""}
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 32px 0; font-size: 15px; line-height: 24px; color: #555;">
                Assigned by <strong>${assignerEmail}</strong>
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td style="background-color: ${primaryColor}; border-radius: 8px;">
                    <a href="${leadLink}" style="display: inline-block; padding: 14px 32px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none;">
                      View Lead
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 13px; color: #aaa; line-height: 20px;">
                If you can't click the button, copy and paste this link into your browser:<br>
                <a href="${leadLink}" style="color: ${primaryColor}; word-break: break-all;">${leadLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafafa; border-top: 1px solid #eee;">
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

export function getLeadAssignedEmailSubject(leadName: string): string {
  return `New lead assigned: ${leadName}`;
}

// For bulk assignments - summary email
interface BulkAssignedEmailTemplateParams {
  tenantName: string;
  assignerEmail: string;
  leadCount: number;
  leadsLink: string;
  primaryColor?: string;
}

export function getBulkAssignedEmailTemplate({
  tenantName,
  assignerEmail,
  leadCount,
  leadsLink,
  primaryColor = "#2272B4",
}: BulkAssignedEmailTemplateParams): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${leadCount} leads assigned to you</title>
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
              <h1 style="margin: 0 0 24px 0; font-size: 24px; font-weight: 600; color: #111;">
                ${leadCount} lead${leadCount !== 1 ? "s" : ""} assigned to you
              </h1>

              <!-- Count Badge -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 32px 0; background-color: #f0f7ff; border-radius: 8px; border: 1px solid #d0e3ff;">
                <tr>
                  <td style="padding: 24px; text-align: center;">
                    <p style="margin: 0 0 8px 0; font-size: 48px; font-weight: 700; color: ${primaryColor};">
                      ${leadCount}
                    </p>
                    <p style="margin: 0; font-size: 14px; color: #666;">
                      new lead${leadCount !== 1 ? "s" : ""} to follow up
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 32px 0; font-size: 15px; line-height: 24px; color: #555;">
                Assigned by <strong>${assignerEmail}</strong>
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0;">
                <tr>
                  <td style="background-color: ${primaryColor}; border-radius: 8px;">
                    <a href="${leadsLink}" style="display: inline-block; padding: 14px 32px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none;">
                      View All Leads
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; background-color: #fafafa; border-top: 1px solid #eee;">
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

export function getBulkAssignedEmailSubject(leadCount: number): string {
  return `${leadCount} lead${leadCount !== 1 ? "s" : ""} assigned to you`;
}
