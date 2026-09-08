import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// resolveTenantSender() never throws — on any DB miss/error it falls back to
// PLATFORM_EMAIL_ADDRESS (derived from PLATFORM_EMAIL_HOST). A random UUID
// tenant, with no matching tenant_email_settings row, exercises exactly that
// fallback whether or not a local Supabase stack is actually running: with
// the stack up, .maybeSingle() returns null data; with it down, the fetch
// itself throws and is caught. Either way, no local DB dependency, so this
// test needs no skip-when-unavailable guard.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const ORIGINAL_ENV = { ...process.env };

describe("resolveTenantSender — PLATFORM_EMAIL_HOST override (F3, docs/BLAST-FINDINGS-2026-09-06.md)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("falls back to the built-in edgex.zunkireelabs.com host when PLATFORM_EMAIL_HOST is unset", async () => {
    delete process.env.PLATFORM_EMAIL_HOST;
    const { resolveTenantSender } = await import("./sender");
    const result = await resolveTenantSender(crypto.randomUUID());
    expect(result.from).toContain("noreply@edgex.zunkireelabs.com");
  });

  it("uses PLATFORM_EMAIL_HOST when set, instead of the production domain — the F3 fix", async () => {
    process.env.PLATFORM_EMAIL_HOST = "local.test";
    const { resolveTenantSender } = await import("./sender");
    const result = await resolveTenantSender(crypto.randomUUID());
    expect(result.from).toContain("noreply@local.test");
    expect(result.from).not.toContain("edgex.zunkireelabs.com");
  });
});
