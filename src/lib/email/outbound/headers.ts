import { PLATFORM_EMAIL_HOST } from "../index";

// RFC 8058 one-click unsubscribe headers. Gmail/Yahoo bulk-sender rules
// require both; Resend supports custom headers on emails.send (§4.5, brief).
export function buildBulkEmailHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>, <mailto:unsubscribe@${PLATFORM_EMAIL_HOST}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
