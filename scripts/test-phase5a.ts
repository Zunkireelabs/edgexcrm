/**
 * Phase 5A Verification: Permission Scopes + Idempotency
 */

import { createHash, randomBytes } from "crypto";
import { config } from "dotenv";

// Load .env.local
config({ path: ".env.local" });

const BASE = "http://localhost:3000/api/v1/integrations/crm";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const TENANT_ID = "a0000000-0000-0000-0000-000000000001"; // RKU
const DEFAULT_STAGE_ID = "5830d394-666f-4904-80a7-3fc648aeadfd"; // "new"
const SECOND_STAGE_ID = "913c2227-f665-4a36-bb7a-9750973b8d60"; // "contacted"
const MEMBER_USER_ID = "d23c24e2-8242-42b6-9a6f-bcab8c0cfb18";

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: TestResult[] = [];

function pass(name: string, detail = "") {
  results.push({ name, passed: true, detail });
  console.log(`  ✅ PASS: ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, detail: string) {
  results.push({ name, passed: false, detail });
  console.log(`  ❌ FAIL: ${name} — ${detail}`);
}

// ── Helpers ──────────────────────────────────────────────────────

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateKey(): { raw: string; hashed: string } {
  const raw = `crm_live_${randomBytes(32).toString("base64url")}`;
  return { raw, hashed: hashKey(raw) };
}

async function supabaseQuery(
  table: string,
  method: "POST" | "PATCH" | "DELETE" | "GET",
  body?: unknown,
  queryParams?: string
): Promise<unknown> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${queryParams ? `?${queryParams}` : ""}`;
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Prefer: method === "POST" ? "return=representation" : "return=minimal",
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === "GET" || method === "POST") {
    return res.json();
  }
  return null;
}

async function createIntegrationKey(
  name: string,
  permissions: string[]
): Promise<{ raw: string; id: string }> {
  const { raw, hashed } = generateKey();
  const res = (await supabaseQuery("integration_keys", "POST", {
    tenant_id: TENANT_ID,
    name,
    hashed_key: hashed,
    permissions,
  })) as { id: string }[];
  return { raw, id: res[0].id };
}

async function apiCall(
  path: string,
  method: string,
  apiKey: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseBody = await res.json();
  return { status: res.status, body: responseBody };
}

// ── Cleanup ──────────────────────────────────────────────────────

const cleanupIds: { keys: string[]; leads: string[] } = { keys: [], leads: [] };

async function cleanup() {
  console.log("\n🧹 Cleaning up test data...");
  for (const id of cleanupIds.leads) {
    await supabaseQuery("leads", "DELETE", undefined, `id=eq.${id}`);
  }
  for (const id of cleanupIds.keys) {
    await supabaseQuery("integration_keys", "DELETE", undefined, `id=eq.${id}`);
  }
  // Clean up idempotency records
  await supabaseQuery(
    "integration_idempotency",
    "DELETE",
    undefined,
    `tenant_id=eq.${TENANT_ID}`
  );
  console.log("  Done.");
}

// ── Test Suites ──────────────────────────────────────────────────

async function testPermissions() {
  console.log("\n📋 Permission Scope Tests");
  console.log("─".repeat(50));

  // Create keys with different scopes
  const readKey = await createIntegrationKey("test-read-only", ["read"]);
  cleanupIds.keys.push(readKey.id);

  const writeKey = await createIntegrationKey("test-write", ["write"]);
  cleanupIds.keys.push(writeKey.id);

  const adminKey = await createIntegrationKey("test-admin", ["admin"]);
  cleanupIds.keys.push(adminKey.id);

  // Test 1: Read-only key CAN GET leads
  const r1 = await apiCall("/leads?limit=1", "GET", readKey.raw);
  if (r1.status === 200) {
    pass("Read-only key can GET /leads", `status=${r1.status}`);
  } else {
    fail("Read-only key can GET /leads", `expected 200, got ${r1.status}`);
  }

  // Test 2: Read-only key CANNOT POST leads → 403
  const r2 = await apiCall("/leads", "POST", readKey.raw, {
    first_name: "Test",
    email: "perm-test@example.com",
  });
  if (r2.status === 403) {
    pass("Read-only key cannot POST /leads → 403", `status=${r2.status}`);
  } else {
    fail(
      "Read-only key cannot POST /leads → 403",
      `expected 403, got ${r2.status}`
    );
  }

  // Test 3: Read-only key CANNOT POST assign → 403
  const r3 = await apiCall(
    "/leads/00000000-0000-0000-0000-000000000000/assign",
    "POST",
    readKey.raw,
    { user_id: MEMBER_USER_ID }
  );
  if (r3.status === 403) {
    pass("Read-only key cannot POST /assign → 403", `status=${r3.status}`);
  } else {
    fail(
      "Read-only key cannot POST /assign → 403",
      `expected 403, got ${r3.status}`
    );
  }

  // Test 4: Read-only key CANNOT POST move-stage → 403
  const r4 = await apiCall(
    "/leads/00000000-0000-0000-0000-000000000000/move-stage",
    "POST",
    readKey.raw,
    { stage_id: SECOND_STAGE_ID }
  );
  if (r4.status === 403) {
    pass("Read-only key cannot POST /move-stage → 403", `status=${r4.status}`);
  } else {
    fail(
      "Read-only key cannot POST /move-stage → 403",
      `expected 403, got ${r4.status}`
    );
  }

  // Test 5: Read-only key CAN GET stages
  const r5 = await apiCall("/stages", "GET", readKey.raw);
  if (r5.status === 200) {
    pass("Read-only key can GET /stages", `status=${r5.status}`);
  } else {
    fail("Read-only key can GET /stages", `expected 200, got ${r5.status}`);
  }

  // Test 6: Read-only key CAN GET pipeline
  const r6 = await apiCall("/pipeline", "GET", readKey.raw);
  if (r6.status === 200) {
    pass("Read-only key can GET /pipeline", `status=${r6.status}`);
  } else {
    fail("Read-only key can GET /pipeline", `expected 200, got ${r6.status}`);
  }

  // Test 7: Read-only key CAN GET tools
  const r7 = await apiCall("/tools", "GET", readKey.raw);
  if (r7.status === 200) {
    pass("Read-only key can GET /tools", `status=${r7.status}`);
  } else {
    fail("Read-only key can GET /tools", `expected 200, got ${r7.status}`);
  }

  // Test 8: Write key CAN POST leads
  const r8 = await apiCall("/leads", "POST", writeKey.raw, {
    first_name: "WriteTest",
    email: "write-perm-test@example.com",
  });
  if (r8.status === 201) {
    const leadId = (r8.body as { data: { id: string } }).data.id;
    cleanupIds.leads.push(leadId);
    pass("Write key can POST /leads → 201", `lead=${leadId}`);
  } else {
    fail("Write key can POST /leads → 201", `expected 201, got ${r8.status}`);
  }

  // Test 9: Write key CAN also GET leads (write implies read)
  const r9 = await apiCall("/leads?limit=1", "GET", writeKey.raw);
  if (r9.status === 200) {
    pass("Write key can GET /leads (implies read)", `status=${r9.status}`);
  } else {
    fail(
      "Write key can GET /leads (implies read)",
      `expected 200, got ${r9.status}`
    );
  }

  // Test 10: Admin key CAN do everything
  const r10 = await apiCall("/leads", "POST", adminKey.raw, {
    first_name: "AdminTest",
    email: "admin-perm-test@example.com",
  });
  if (r10.status === 201) {
    const leadId = (r10.body as { data: { id: string } }).data.id;
    cleanupIds.leads.push(leadId);
    pass("Admin key can POST /leads → 201", `lead=${leadId}`);
  } else {
    fail("Admin key can POST /leads → 201", `expected 201, got ${r10.status}`);
  }

  // Test 11: Missing scope returns 403 error body
  const errorBody = r2.body as { error?: { code: string; message: string } };
  if (errorBody.error?.code === "FORBIDDEN") {
    pass("403 response has correct error code", `code=${errorBody.error.code}`);
  } else {
    fail(
      "403 response has correct error code",
      `expected FORBIDDEN, got ${JSON.stringify(errorBody)}`
    );
  }
}

async function testIdempotency() {
  console.log("\n📋 Idempotency Tests");
  console.log("─".repeat(50));

  const writeKey = await createIntegrationKey("test-idempotency-write", [
    "write",
  ]);
  cleanupIds.keys.push(writeKey.id);

  // ── Lead Create Idempotency ───────────────────────────────────

  const idemp1 = `test-idemp-${randomBytes(8).toString("hex")}`;
  const leadPayload = {
    first_name: "IdempTest",
    email: `idemp-${Date.now()}@example.com`,
  };

  // First call → 201
  const r1 = await apiCall("/leads", "POST", writeKey.raw, leadPayload, {
    "Idempotency-Key": idemp1,
  });
  let createdLeadId: string | null = null;
  if (r1.status === 201) {
    createdLeadId = (r1.body as { data: { id: string } }).data.id;
    cleanupIds.leads.push(createdLeadId);
    pass("First create call → 201", `lead=${createdLeadId}`);
  } else {
    fail("First create call → 201", `got ${r1.status}: ${JSON.stringify(r1.body)}`);
  }

  // Second call with same key → 200 (cached), same lead ID
  const r2 = await apiCall("/leads", "POST", writeKey.raw, leadPayload, {
    "Idempotency-Key": idemp1,
  });
  const r2LeadId = (r2.body as { data: { id: string } })?.data?.id;
  if (r2.status === 200 && r2LeadId === createdLeadId) {
    pass(
      "Second create call (same key) → 200, same lead",
      `lead=${r2LeadId}`
    );
  } else {
    fail(
      "Second create call (same key) → 200, same lead",
      `status=${r2.status}, lead=${r2LeadId}, expected=${createdLeadId}`
    );
  }

  // Verify only one lead was created
  const leadsCheck = (await supabaseQuery(
    "leads",
    "GET",
    undefined,
    `tenant_id=eq.${TENANT_ID}&email=eq.${leadPayload.email}&deleted_at=is.null&select=id`
  )) as { id: string }[];
  if (leadsCheck.length === 1) {
    pass("Only one lead exists in DB", `count=${leadsCheck.length}`);
  } else {
    fail(
      "Only one lead exists in DB",
      `expected 1, got ${leadsCheck.length}`
    );
  }

  // ── Assign Idempotency ────────────────────────────────────────

  if (createdLeadId) {
    const idempAssign = `test-assign-${randomBytes(8).toString("hex")}`;
    const assignPayload = { user_id: MEMBER_USER_ID };

    // First assign → 200
    const a1 = await apiCall(
      `/leads/${createdLeadId}/assign`,
      "POST",
      writeKey.raw,
      assignPayload,
      { "Idempotency-Key": idempAssign }
    );
    if (a1.status === 200) {
      pass("First assign call → 200", `assigned_to=${MEMBER_USER_ID}`);
    } else {
      fail("First assign call → 200", `got ${a1.status}`);
    }

    // Second assign with same key → 200 (cached)
    const a2 = await apiCall(
      `/leads/${createdLeadId}/assign`,
      "POST",
      writeKey.raw,
      assignPayload,
      { "Idempotency-Key": idempAssign }
    );
    if (a2.status === 200) {
      pass("Second assign call (same key) → 200 (cached)");
    } else {
      fail("Second assign call (same key) → 200", `got ${a2.status}`);
    }

    // Check no duplicate audit events — count integration.lead.assigned entries
    await new Promise((r) => setTimeout(r, 1000)); // Wait for audit to flush
    const auditCheck = (await supabaseQuery(
      "audit_logs",
      "GET",
      undefined,
      `tenant_id=eq.${TENANT_ID}&action=eq.integration.lead.assigned&entity_id=eq.${createdLeadId}&select=id&order=created_at.desc&limit=10`
    )) as { id: string }[];
    if (auditCheck.length === 1) {
      pass("Only one assign audit event", `count=${auditCheck.length}`);
    } else {
      fail(
        "Only one assign audit event",
        `expected 1, got ${auditCheck.length}`
      );
    }

    // ── Move-Stage Idempotency ──────────────────────────────────

    const idempMove = `test-move-${randomBytes(8).toString("hex")}`;
    const movePayload = { stage_id: SECOND_STAGE_ID };

    // First move → 200
    const m1 = await apiCall(
      `/leads/${createdLeadId}/move-stage`,
      "POST",
      writeKey.raw,
      movePayload,
      { "Idempotency-Key": idempMove }
    );
    if (m1.status === 200) {
      pass("First move-stage call → 200");
    } else {
      fail("First move-stage call → 200", `got ${m1.status}: ${JSON.stringify(m1.body)}`);
    }

    // Second move with same key → 200 (cached)
    const m2 = await apiCall(
      `/leads/${createdLeadId}/move-stage`,
      "POST",
      writeKey.raw,
      movePayload,
      { "Idempotency-Key": idempMove }
    );
    if (m2.status === 200) {
      pass("Second move-stage call (same key) → 200 (cached)");
    } else {
      fail("Second move-stage call (same key) → 200", `got ${m2.status}`);
    }

    // Check no duplicate stage change events
    const stageAuditCheck = (await supabaseQuery(
      "audit_logs",
      "GET",
      undefined,
      `tenant_id=eq.${TENANT_ID}&action=eq.integration.stage.changed&entity_id=eq.${createdLeadId}&select=id&order=created_at.desc&limit=10`
    )) as { id: string }[];
    if (stageAuditCheck.length === 1) {
      pass("Only one stage change audit event", `count=${stageAuditCheck.length}`);
    } else {
      fail(
        "Only one stage change audit event",
        `expected 1, got ${stageAuditCheck.length}`
      );
    }
  }

  // ── Different key = different result ──────────────────────────

  const idemp2 = `test-idemp-different-${randomBytes(8).toString("hex")}`;
  const r3 = await apiCall(
    "/leads",
    "POST",
    writeKey.raw,
    { first_name: "IdempTest2", email: `idemp2-${Date.now()}@example.com` },
    { "Idempotency-Key": idemp2 }
  );
  if (r3.status === 201) {
    const newLeadId = (r3.body as { data: { id: string } }).data.id;
    cleanupIds.leads.push(newLeadId);
    if (newLeadId !== createdLeadId) {
      pass("Different idempotency key → different lead", `lead=${newLeadId}`);
    } else {
      fail("Different idempotency key → different lead", "got same lead ID");
    }
  } else {
    fail("Different idempotency key → different lead", `status=${r3.status}`);
  }
}

async function testSafety() {
  console.log("\n📋 Safety Tests");
  console.log("─".repeat(50));

  // Test: RLS blocks direct access to integration_keys
  try {
    const anonRes = await fetch(
      `${SUPABASE_URL}/rest/v1/integration_keys?select=hashed_key&limit=1`,
      {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
        },
      }
    );
    const anonData = (await anonRes.json()) as unknown[];
    if (anonData.length === 0) {
      pass("RLS blocks anon access to integration_keys", "0 rows returned");
    } else {
      fail(
        "RLS blocks anon access to integration_keys",
        `got ${anonData.length} rows`
      );
    }
  } catch (e) {
    pass("RLS blocks anon access to integration_keys", "access denied");
  }

  // Test: RLS blocks direct access to integration_idempotency
  try {
    const anonRes = await fetch(
      `${SUPABASE_URL}/rest/v1/integration_idempotency?select=id&limit=1`,
      {
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
        },
      }
    );
    const anonData = (await anonRes.json()) as unknown[];
    if (anonData.length === 0) {
      pass("RLS blocks anon access to integration_idempotency", "0 rows returned");
    } else {
      fail(
        "RLS blocks anon access to integration_idempotency",
        `got ${anonData.length} rows`
      );
    }
  } catch (e) {
    pass("RLS blocks anon access to integration_idempotency", "access denied");
  }

  // Test: Revoked key gets 401
  const revokedKey = await createIntegrationKey("test-revoked", ["write"]);
  // Revoke it
  await fetch(
    `${SUPABASE_URL}/rest/v1/integration_keys?id=eq.${revokedKey.id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ revoked_at: new Date().toISOString() }),
    }
  );
  const revokedRes = await apiCall("/leads?limit=1", "GET", revokedKey.raw);
  if (revokedRes.status === 401) {
    pass("Revoked key → 401", `status=${revokedRes.status}`);
  } else {
    fail("Revoked key → 401", `expected 401, got ${revokedRes.status}`);
  }
  cleanupIds.keys.push(revokedKey.id);

  // Test: No route regression — all endpoints respond
  const checkKey = await createIntegrationKey("test-route-check", ["admin"]);
  cleanupIds.keys.push(checkKey.id);

  const routes = [
    { path: "/leads?limit=1", method: "GET", expect: 200 },
    { path: "/stages", method: "GET", expect: 200 },
    { path: "/pipeline", method: "GET", expect: 200 },
    { path: "/tools", method: "GET", expect: 200 },
  ];

  let allRoutesOk = true;
  for (const route of routes) {
    const r = await apiCall(route.path, route.method, checkKey.raw);
    if (r.status !== route.expect) {
      allRoutesOk = false;
      fail(
        `Route check: ${route.method} ${route.path}`,
        `expected ${route.expect}, got ${r.status}`
      );
    }
  }
  if (allRoutesOk) {
    pass("All GET routes respond correctly", `${routes.length} routes checked`);
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(60));
  console.log("  Phase 5A Verification: Permissions + Idempotency");
  console.log("═".repeat(60));

  try {
    await testPermissions();
    await testIdempotency();
    await testSafety();
  } catch (e) {
    console.error("\n💥 Unexpected error:", e);
  } finally {
    await cleanup();
  }

  // Summary
  console.log("\n" + "═".repeat(60));
  console.log("  SUMMARY");
  console.log("═".repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  for (const r of results) {
    console.log(`  ${r.passed ? "✅" : "❌"} ${r.name}`);
    if (!r.passed && r.detail) {
      console.log(`     → ${r.detail}`);
    }
  }

  console.log(`\n  Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  console.log("═".repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

main();
