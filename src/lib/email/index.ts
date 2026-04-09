import { Resend } from "resend";

// Initialize Resend client lazily to avoid build errors when API key is not set
let _resend: Resend | null = null;

export function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[Email] RESEND_API_KEY not configured - emails disabled");
    return null;
  }
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

// Email sender address - using verified domain
export const EMAIL_FROM = "Lead Gen CRM <noreply@lead-crm.zunkireelabs.com>";

// App URL for email links
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://lead-crm.zunkireelabs.com";
