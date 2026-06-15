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

// Platform email host — kept on the Resend-verified domain (NOT migrated to edgex; moving the
// from-address needs separate Resend domain verification). Single source of truth.
export const PLATFORM_EMAIL_HOST = "lead-crm.zunkireelabs.com";
export const PLATFORM_EMAIL_ADDRESS = `noreply@${PLATFORM_EMAIL_HOST}`;

// Email sender address - using verified domain
export const EMAIL_FROM = `EdgeX <${PLATFORM_EMAIL_ADDRESS}>`;
// App URL for email links
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://edgex.zunkireelabs.com";
