import type { ProviderReportRow, SmsErrorCode, SmsProvider, SmsSendOutcome } from "./types";

// Aakash SMS v3 send + v4 read endpoints. v3 send is the only send path this
// phase ships. The v4 send endpoint is `/sms/v4/send` (confirmed by preflight
// against the live API — the brief's `/sms/v4/send-user` guess was wrong);
// doesn't matter for Phase 1 since v3 ships, but noted here so the next
// person doesn't repeat the dead end.
//
// CRITICAL: Aakash returns HTTP 200 even on failure — the error is only in the
// JSON body's `error` field. Never branch on res.ok.

const DEFAULT_BASE_URL = "https://sms.aakashsms.com";
const SEND_TIMEOUT_MS = 20_000;

// Our own conservative cap, not a published Aakash limit — undocumented rate
// limits/max-recipients mean we self-impose 100 per call until proven otherwise.
export const MAX_RECIPIENTS_PER_CALL = 100;

interface AakashSendResponseValid {
  id: string; // Observed "13421_178679570267557" — a string, not a number (L-2, SMS-PHASE1-REVIEW.md).
  mobile: string;
  text: string;
  credit: number;
  network: string;
  status: string;
  shortcode?: string;
}

interface AakashSendResponseInvalid {
  mobile: string;
  text: string;
  credit: number;
  network: string;
  status: string;
}

interface AakashSendResponse {
  error: boolean;
  message: string;
  data?: {
    valid?: AakashSendResponseValid[];
    invalid?: AakashSendResponseInvalid[];
  };
}

function mapErrorMessage(message: string): { code: SmsErrorCode; retryable: boolean } {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("not enough balance")) return { code: "insufficient_balance", retryable: false };
  // Covers both the v3 "The provided Auth Token is not valid." and the v4
  // "Authentication token is invalid or expired." messages.
  if (normalized.includes("token") && (normalized.includes("invalid") || normalized.includes("not valid") || normalized.includes("expired")))
    return { code: "invalid_token", retryable: false };
  if (normalized.includes("no valid recipients")) return { code: "no_valid_recipients", retryable: false };
  if (normalized.includes("all messages encountered errors")) return { code: "all_failed", retryable: false };
  return { code: "unknown", retryable: false };
}

function baseUrl(): string {
  return process.env.AAKASH_SMS_BASE_URL || DEFAULT_BASE_URL;
}

function authToken(): string {
  const token = process.env.AAKASH_SMS_TOKEN;
  if (!token) throw new Error("AAKASH_SMS_TOKEN is not configured");
  return token;
}

export function aakashProvider(): SmsProvider {
  return {
    async send({ to, text }): Promise<SmsSendOutcome> {
      if (to.length > MAX_RECIPIENTS_PER_CALL) {
        throw new Error(`aakashProvider.send: ${to.length} recipients exceeds self-imposed cap of ${MAX_RECIPIENTS_PER_CALL}`);
      }

      const token = authToken(); // config error — deliberately outside the try/catch below so a missing token throws rather than being reported as a retryable network failure.

      let res: Response;
      try {
        res = await fetch(`${baseUrl()}/sms/v3/send`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            auth_token: token,
            to: to.join(","),
            text,
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch (err) {
        return {
          ok: false,
          code: "network",
          message: err instanceof Error ? err.message : "fetch failed",
          retryable: true,
        };
      }

      if (res.status >= 500) {
        return { ok: false, code: "network", message: `HTTP ${res.status}`, retryable: true };
      }

      let json: AakashSendResponse;
      try {
        json = (await res.json()) as AakashSendResponse;
      } catch {
        return { ok: false, code: "unknown", message: "non-JSON response body", retryable: true };
      }

      // DO NOT branch on res.ok — Aakash returns HTTP 200 for provider-level
      // failures; `error` in the JSON body is the only reliable signal.
      if (json.error) {
        const { code, retryable } = mapErrorMessage(json.message);
        return { ok: false, code, message: json.message, retryable };
      }

      return {
        ok: true,
        result: {
          valid: (json.data?.valid ?? []).map((v) => ({
            id: String(v.id),
            mobile: v.mobile,
            credit: v.credit,
            network: v.network,
            status: v.status,
            shortcode: v.shortcode ?? null,
          })),
          invalid: (json.data?.invalid ?? []).map((v) => ({
            mobile: v.mobile,
            message: v.status,
          })),
        },
      };
    },

    async availableCredit(): Promise<number | null> {
      try {
        const res = await fetch(`${baseUrl()}/sms/v4/available-credit`, {
          headers: { "auth-token": authToken() },
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { available_credit?: number };
        return json.available_credit ?? null;
      } catch {
        return null;
      }
    },

    async report(startDate: string, endDate: string): Promise<ProviderReportRow[]> {
      try {
        const res = await fetch(`${baseUrl()}/sms/v4/api-report`, {
          method: "POST",
          headers: {
            "auth-token": authToken(),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ start_date: startDate, end_date: endDate }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        if (!res.ok) return [];
        const json = (await res.json()) as { data?: { result?: { data?: ProviderReportRow[] } } };
        return json.data?.result?.data ?? [];
      } catch {
        return [];
      }
    },
  };
}
