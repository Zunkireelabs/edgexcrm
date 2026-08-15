import { randomUUID, createHash } from "crypto";
import { countSegments } from "../segments";
import type { ProviderReportRow, SmsErrorCode, SmsProvider, SmsSendOutcome } from "./types";

// Local-dev provider. Deterministic (hash-based) valid/invalid split so tests
// and manual runs are reproducible, computes credits via our own countSegments
// (the real billing math), and logs every rendered body to stdout so a human
// can read the actual SMS text without a live provider.
//
// Force a specific failure branch locally via SMS_MOCK_FAIL=<code>, e.g.
// SMS_MOCK_FAIL=insufficient_balance.

const INVALID_RATE = 0.03;

function hashToUnit(input: string): number {
  const hash = createHash("sha256").update(input).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
}

function forcedFailure(): { code: SmsErrorCode; message: string; retryable: boolean } | null {
  const forced = process.env.SMS_MOCK_FAIL;
  if (!forced) return null;
  const messages: Record<string, string> = {
    insufficient_balance: "Not enough balance.",
    invalid_token: "The provided Auth Token is not valid.",
    no_valid_recipients: "No valid recipients.",
    all_failed: "All messages encountered errors.",
    network: "network error (forced)",
  };
  const retryable = forced === "network";
  return { code: forced as SmsErrorCode, message: messages[forced] ?? "forced mock failure", retryable };
}

export function mockProvider(): SmsProvider {
  return {
    async send({ to, text }): Promise<SmsSendOutcome> {
      const forced = forcedFailure();
      if (forced) {
        console.log(`[sms:mock] forced failure via SMS_MOCK_FAIL=${process.env.SMS_MOCK_FAIL}: ${forced.message}`);
        return { ok: false, ...forced };
      }

      console.log(`[sms:mock] send() — ${to.length} recipient(s)`);
      console.log(`[sms:mock] body: ${text}`);

      const { credits } = countSegments(text);

      const validList: { id: string; mobile: string; credit: number; network: string; status: string }[] = [];
      const invalidList: { mobile: string; message: string }[] = [];

      to.forEach((mobile, i) => {
        const isInvalid = hashToUnit(`${mobile}:${i}`) < INVALID_RATE;
        if (isInvalid) {
          invalidList.push({ mobile, message: "aborted" });
          console.log(`[sms:mock]   ${mobile} -> invalid (aborted)`);
          return;
        }
        const network = hashToUnit(`net:${mobile}`) < 0.5 ? "ntc" : "ncell";
        const id = `mock-${randomUUID()}`;
        validList.push({ id, mobile, credit: credits, network, status: "queued" });
        console.log(`[sms:mock]   ${mobile} -> queued (credit=${credits}, network=${network}, id=${id})`);
      });

      if (validList.length === 0) {
        return { ok: false, code: "no_valid_recipients", message: "No valid recipients.", retryable: false };
      }

      return { ok: true, result: { valid: validList, invalid: invalidList } };
    },

    async availableCredit(): Promise<number | null> {
      return null;
    },

    async report(_startDate: string, _endDate: string): Promise<ProviderReportRow[]> {
      return [];
    },
  };
}
