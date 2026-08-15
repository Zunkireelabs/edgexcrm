import type { SmsSendResult } from "./provider/types";

// Pure attribution logic for sendQueuedBatch's provider write-back, split out
// so the regression (matching Aakash's valid[]/invalid[] response back to
// sms_messages rows) is unit testable without a database — send.ts needs
// scopedClientForTenant, and CI's Test job has no DB to run against.

export interface AttributionMessage {
  id: string;
  to_phone: string;
}

export interface AttributionInput {
  messages: AttributionMessage[];
  result: SmsSendResult;
  sandboxed: boolean;
}

export type Attribution =
  | {
      messageId: string;
      outcome: "submitted";
      providerMessageId: string;
      credit: number;
      network: string;
      providerStatus: string;
      shortcode: string | null;
    }
  | { messageId: string; outcome: "failed"; errorCode: string; errorMessage: string };

export interface AttributionResult {
  attributions: Attribution[];
  totalCreditsCharged: number;
  unmatched: string[];
}

// Aakash echoes mobiles back in the same bare-10-digit shape we send, but
// matching raw-string equality against a provider-controlled field is exactly
// the kind of assumption that breaks silently in production. Normalize both
// sides to their last 10 digits before comparing.
function normalizeMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  return digits.slice(-10);
}

export function attributeProviderResults(input: AttributionInput): AttributionResult {
  const { messages, result, sandboxed } = input;

  if (sandboxed) {
    const byIndex = result.valid;
    const attributions: Attribution[] = [];
    let totalCreditsCharged = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const providerResult = byIndex[i] ?? byIndex[byIndex.length - 1];
      if (!providerResult) {
        attributions.push({
          messageId: msg.id,
          outcome: "failed",
          errorCode: "no_provider_result",
          errorMessage: "No provider result available for sandbox recipient.",
        });
        continue;
      }
      totalCreditsCharged += providerResult.credit;
      attributions.push({
        messageId: msg.id,
        outcome: "submitted",
        providerMessageId: providerResult.id,
        credit: providerResult.credit,
        network: providerResult.network,
        providerStatus: providerResult.status,
        shortcode: providerResult.shortcode ?? null,
      });
    }

    return { attributions, totalCreditsCharged, unmatched: [] };
  }

  const validByMobile = new Map<string, (typeof result.valid)[number]>();
  for (const row of result.valid) validByMobile.set(normalizeMobile(row.mobile), row);

  const invalidByMobile = new Map<string, (typeof result.invalid)[number]>();
  for (const row of result.invalid) invalidByMobile.set(normalizeMobile(row.mobile), row);

  const attributions: Attribution[] = [];
  const unmatched: string[] = [];

  for (const msg of messages) {
    const key = normalizeMobile(msg.to_phone);
    const validRow = validByMobile.get(key);
    if (validRow) {
      attributions.push({
        messageId: msg.id,
        outcome: "submitted",
        providerMessageId: validRow.id,
        credit: validRow.credit,
        network: validRow.network,
        providerStatus: validRow.status,
        shortcode: validRow.shortcode ?? null,
      });
      continue;
    }

    const invalidRow = invalidByMobile.get(key);
    if (invalidRow) {
      attributions.push({
        messageId: msg.id,
        outcome: "failed",
        errorCode: "provider_rejected",
        errorMessage: invalidRow.message,
      });
      continue;
    }

    unmatched.push(msg.id);
    attributions.push({
      messageId: msg.id,
      outcome: "failed",
      errorCode: "no_provider_result",
      errorMessage: "Recipient found in neither the provider's valid nor invalid results.",
    });
  }

  // Ground truth for billing is the provider's own valid[] total, not the
  // per-row loop above — decouples attribution bugs from billing bugs, and
  // correctly counts a shared phone number's credit once even though both
  // message rows attribute to it.
  const totalCreditsCharged = result.valid.reduce((sum, row) => sum + row.credit, 0);

  return { attributions, totalCreditsCharged, unmatched };
}
