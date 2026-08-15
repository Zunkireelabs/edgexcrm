import { isSmsSandbox } from "./flag";

// The single highest-value safety mechanism in this feature. isSmsSandbox()
// defaults to TRUE (see flag.ts), so unless an environment explicitly sets
// SMS_SANDBOX=false, every outbound send below is silently redirected to a
// fixed test-recipient list — it must be impossible to bypass this by accident.
//
// applyEnvGuard() is called from send.ts immediately before the provider call,
// so there is no code path between "recipients resolved from the DB" and
// "provider.send() invoked" that skips it.

export interface EnvGuardResult {
  to: string[];
  intendedTo: string[];
  text: string;
  sandboxed: boolean;
}

function testRecipients(): string[] {
  return (process.env.SMS_TEST_RECIPIENTS || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

export function applyEnvGuard(intendedTo: string[], text: string): EnvGuardResult {
  if (!isSmsSandbox()) {
    return { to: intendedTo, intendedTo, text, sandboxed: false };
  }

  const redirectTo = testRecipients();
  if (redirectTo.length === 0) {
    throw new Error(
      "SMS_SANDBOX is enabled (the default) but SMS_TEST_RECIPIENTS is empty — " +
        "cannot safely redirect outbound SMS. Set SMS_TEST_RECIPIENTS or explicitly SMS_SANDBOX=false."
    );
  }

  const prefixedText = `[SANDBOX intended: ${intendedTo.join(", ")}] ${text}`;
  return { to: redirectTo, intendedTo, text: prefixedText, sandboxed: true };
}
