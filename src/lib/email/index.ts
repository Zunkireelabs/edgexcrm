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

// Platform email host — the Resend-verified domain outbound mail is sent from. Single source
// of truth. Migrated from lead-crm.zunkireelabs.com to edgex.zunkireelabs.com on 2026-08-21
// once edgex was DKIM/SPF-verified in Resend (docs/DOMAIN-MIGRATION-BRIEF.md).
export const PLATFORM_EMAIL_HOST = "edgex.zunkireelabs.com";
export const PLATFORM_EMAIL_ADDRESS = `noreply@${PLATFORM_EMAIL_HOST}`;

// Email sender address - using verified domain
export const EMAIL_FROM = `EdgeX <${PLATFORM_EMAIL_ADDRESS}>`;
// App URL for email links
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://edgex.zunkireelabs.com";
