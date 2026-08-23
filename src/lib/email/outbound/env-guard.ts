import { isEmailOutboundSandbox } from "./flag";

// The single highest-value safety mechanism in this feature. Mirrors
// src/lib/sms/env-guard.ts. isEmailOutboundSandbox() defaults to TRUE (see
// flag.ts), so unless an environment explicitly sets EMAIL_OUTBOUND_SANDBOX=
// false, every outbound send below is silently redirected to a fixed
// test-recipient list — it must be impossible to bypass this by accident.
//
// applyEmailEnvGuard() is called from send.ts immediately before the provider
// call, per-row, so there is no code path between "recipient resolved from
// the DB" and "resend.emails.send() invoked" that skips it.

export interface EmailEnvGuardResult {
  to: string[];
  intendedTo: string;
  subject: string;
  sandboxed: boolean;
}

function testRecipients(): string[] {
  return (process.env.EMAIL_TEST_RECIPIENTS || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

export function applyEmailEnvGuard(intendedTo: string, subject: string): EmailEnvGuardResult {
  if (!isEmailOutboundSandbox()) {
    return { to: [intendedTo], intendedTo, subject, sandboxed: false };
  }

  const redirectTo = testRecipients();
  if (redirectTo.length === 0) {
    throw new Error(
      "EMAIL_OUTBOUND_SANDBOX is enabled (the default) but EMAIL_TEST_RECIPIENTS is empty — " +
        "cannot safely redirect outbound email. Set EMAIL_TEST_RECIPIENTS or explicitly EMAIL_OUTBOUND_SANDBOX=false."
    );
  }

  return { to: redirectTo, intendedTo, subject: `[SANDBOX intended: ${intendedTo}] ${subject}`, sandboxed: true };
}
