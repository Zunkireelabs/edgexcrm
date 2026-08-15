import { aakashProvider } from "./aakash";
import { mockProvider } from "./mock";
import type { SmsProvider } from "./types";

let _provider: SmsProvider | null = null;
let _providerKind: "aakash" | "mock" | null = null;

// Lazy singleton, in the style of src/lib/email/index.ts, with one deliberate
// difference: this falls back to the MOCK provider rather than returning null.
// A null provider would force every caller to branch defensively; a mock keeps
// the whole send pipeline exercised in every environment and makes "accidentally
// live" impossible by default — going live requires BOTH SMS_PROVIDER=aakash AND
// a configured AAKASH_SMS_TOKEN.
export function getSmsProvider(): SmsProvider {
  const kind: "aakash" | "mock" =
    process.env.SMS_PROVIDER === "aakash" && process.env.AAKASH_SMS_TOKEN ? "aakash" : "mock";

  if (_provider && _providerKind === kind) return _provider;

  _provider = kind === "aakash" ? aakashProvider() : mockProvider();
  _providerKind = kind;
  return _provider;
}
