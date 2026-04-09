import { Resend } from "resend";

// Initialize Resend client
export const resend = new Resend(process.env.RESEND_API_KEY);

// Email sender address - using verified domain
export const EMAIL_FROM = "Lead Gen CRM <noreply@lead-crm.zunkireelabs.com>";

// App URL for email links
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://lead-crm.zunkireelabs.com";
