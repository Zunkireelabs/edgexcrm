// Outreach channels. A sequence is exactly one of these (email_sequences.channel, migration 274); its
// enrollments and drafts follow it. Email and SMS are separate on purpose: different content (subject +
// rich body vs plain text), limits (SMS segments), cost (credits vs the daily email cap), and compliance.

export const OUTREACH_CHANNELS = ["email", "sms"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export const DEFAULT_OUTREACH_CHANNEL: OutreachChannel = "email";

export function isOutreachChannel(value: unknown): value is OutreachChannel {
  return typeof value === "string" && (OUTREACH_CHANNELS as readonly string[]).includes(value);
}

/** Anything unrecognised (including a NULL from a pre-274 row) reads as email, the only channel that existed. */
export function channelOf(row: { channel?: string | null } | null | undefined): OutreachChannel {
  return row?.channel === "sms" ? "sms" : "email";
}

export const CHANNEL_LABEL: Record<OutreachChannel, string> = { email: "Email", sms: "SMS" };
