# Executor Brief — Phase 1A: AI Foundation Plumbing

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-15
**Parent plan:** `docs/ai-native-efforts/01-PHASE-1-ASSISTANT-FOUNDATION.md` (this is the FIRST of three slices: 1A plumbing → 1B brain → 1C surfaces/gates).
**Governing docs:** ADR-001 (`00-DECISIONS-ADR.md`), cross-cutting (`05-CROSS-CUTTING-PLATFORM.md`), tenant-isolation rules in `CLAUDE.md`.

---

## What 1A is (and is NOT)

**Is:** the load-bearing skeleton every later AI phase builds on — provider seam, model registry, the tool contract + registry, the persistence tables, the security guardrails, the feature flag. **No user-visible behavior. The existing keyword mock at `/api/v1/ai/chat` stays untouched this slice.**

**Is NOT (do not build in 1A — these are 1B/1C):** the 8 tools, the chat API rewrite, `streamText`, any UI, real Langfuse. Registering a real tool, calling an LLM, or touching the assistant panel is **out of scope** — resist it.

**Provider decision for the demo:** default to **OpenAI** (Sadin has an OpenAI key, no Anthropic key yet). The seam must make swapping to Claude a **one-env-var flip** later (`ANTHROPIC_API_KEY` present ⇒ Claude). Both provider adapters are installed now so the swap needs no `npm i` later.

**Cost:** 1A calls **no LLM** and needs **no external accounts** (Langfuse is a no-op seam this slice). $0 spend.

---

## Step 1 — Branch

Work directly in `/home/sadin/edgeXcrm` (sole user, no worktree). Base the new branch on the real-estate branch so the foundation and the real-estate demo live in one tree:

```bash
git switch feature/real-estate-vertical
git pull --ff-only 2>/dev/null || true          # it's local-ahead; fine if nothing to pull
git switch -c feature/ai-assistant-foundation
```

> Rationale (from Opus): foundation files are disjoint from `src/industries/real-estate/`, so this base carries the demo work with zero conflict risk and keeps the foundation separable for later productionization.

---

## Step 2 — Dependencies

```bash
npm i ai @ai-sdk/openai @ai-sdk/anthropic zod
```

(`zod` may already be present — fine.) **Do NOT install `langfuse` in 1A** — telemetry is a no-op seam here; the real dep comes in 1C. Confirm `package.json`/`package-lock.json` diff shows only the four above (or fewer if some pre-exist).

---

## Step 3 — Env

Add to **local `.env.local` only** (this branch is a local demo build; VPS `.env.local` + GH secrets come at 1C promotion time):

```
OPENAI_API_KEY=sk-...            # Sadin provides
AI_ASSISTANT_ENABLED=true        # local dev on
# ANTHROPIC_API_KEY intentionally absent — provider seam falls back to OpenAI
# LANGFUSE_* not needed in 1A
```

Do not commit `.env.local`. Document the new vars in a short block appended to `docs/ai-native-efforts/01-PHASE-1-ASSISTANT-FOUNDATION.md` under a "Provider status (1A)" note.

---

## Step 4 — `src/lib/ai/` skeleton (all new files)

```
src/lib/ai/
  models.ts        # the ONLY place model ids live
  provider.ts      # provider selection + swap seam
  telemetry.ts     # no-op trace seam (Langfuse lands in 1C behind this interface)
  tools/
    types.ts       # AgentTool + ToolContext contracts (verbatim below)
    registry.ts    # buildToolset(auth) + registration guards
```

### `models.ts`
```ts
// The ONLY place model ids live. Provider swap = set ANTHROPIC_API_KEY (see provider.ts).
export const MODELS = {
  openai:    { agent: "gpt-4o-mini", fast: "gpt-4o-mini" },      // demo default — mini tier to conserve budget
  anthropic: { agent: "claude-sonnet-5", fast: "claude-haiku-4-5" }, // activates when ANTHROPIC_API_KEY is set
} as const;

export const ACTIVE_PROVIDER: "openai" | "anthropic" =
  process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai";
```
> Confirm the current OpenAI model ids at build time; if `gpt-4o-mini` is superseded, use the current mini/flagship-mini id — but keep them centralized here only.

### `provider.ts`
```ts
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { MODELS, ACTIVE_PROVIDER } from "./models";

// Returns an AI SDK model instance for a logical role. Swapping providers is one env var.
export function model(kind: "agent" | "fast") {
  const id = MODELS[ACTIVE_PROVIDER][kind];
  return ACTIVE_PROVIDER === "anthropic" ? anthropic(id) : openai(id);
}
```

### `telemetry.ts` (no-op seam — 1C swaps the body for Langfuse)
```ts
// Phase 1A: no-op tracing seam. 1C wires Langfuse behind this SAME interface — callers never change.
export interface Trace {
  span(name: string, data?: Record<string, unknown>): void;
  end(data?: Record<string, unknown>): void;
}
export function startTrace(_meta: {
  runId: string; tenantId: string; userId?: string; industryId: string | null; surface: string;
}): Trace {
  return { span() {}, end() {} };
}
```

### `tools/types.ts` (the most important contract in the whole track — use verbatim)
```ts
import { z } from "zod";
import type { AuthContext } from "@/lib/api/auth";
import type { ScopedClient } from "@/lib/supabase/scoped"; // confirm exported type name
import type { Logger } from "pino";
import type { IndustryId } from "@/industries/_registry"; // confirm exported type name/path

export interface ToolContext {
  auth: AuthContext;      // Phase 3 widens to AuthContext | AgentAuthContext
  db: ScopedClient;       // ALWAYS scopedClient(auth) — never the service client
  logger: Logger;         // request logger, child-scoped per tool call
  runId: string;          // correlates audit rows + telemetry trace
}

export interface AgentTool<In = unknown, Out = unknown> {
  id: string;
  description: string;                 // written for the model — concrete, with when-to-use
  inputSchema: z.ZodType<In>;
  scope: "read" | "write";             // 1A registry REJECTS "write" at registration
  requiredPermission?: string;         // key into resolved permissions; checked before execute
  industries?: IndustryId[];           // undefined = universal
  execute(ctx: ToolContext, input: In): Promise<Out>;
}
```

### `tools/registry.ts`
- Export `registerTool(tool: AgentTool)` and `buildToolset(auth: AuthContext): AgentTool[]`.
- **Guards (enforced here, unit-tested in Step 7):**
  1. Registering a tool with `scope: "write"` **throws at registration** (Phase 1 rejects writes). Message: `"write-scope tools are not permitted before Phase 4"`.
  2. `buildToolset(auth)` returns only tools where (`industries` is undefined **or** includes `auth.industryId`) **and** (`requiredPermission` is undefined **or** the auth holds it — resolve via the existing permission resolver used by REST routes; if unsure of the exact helper, leave a `TODO(1B)` and filter on industry only for now, noting it in the report).
- **1A ships ZERO real tools registered.** The registry is exercised only by fixture tools inside the unit test. (Real tools arrive in 1B.)

---

## Step 5 — Persistence migration (LOCAL only)

Next migration number: run `ls supabase/migrations/ | sort | tail -3` and take the next free integer (on this branch that should be **160**, after the local real-estate `156–159`). One file, transactional, additive, rollback line + before/after counts.

Three tenant-owned tables, **RLS with the SECURITY DEFINER helpers** (`get_user_tenant_ids()` SELECT, `is_tenant_admin(tenant_id)` mutations), per the standard checklist:

```sql
ai_conversations (id uuid pk, tenant_id fk→tenants ON DELETE CASCADE, user_id uuid, title text,
                  created_at timestamptz default now(), updated_at timestamptz default now())

ai_messages      (id uuid pk, tenant_id fk, conversation_id fk→ai_conversations ON DELETE CASCADE,
                  role text check (role in ('user','assistant','tool')),
                  content jsonb not null, model text, input_tokens int, output_tokens int,
                  created_at timestamptz default now())

ai_usage_events  (id uuid pk, tenant_id fk, user_id uuid, agent_id uuid null, run_id text, model text,
                  input_tokens int, output_tokens int, tool_calls int,
                  surface text,   -- 'assistant' | 'ingestion' | 'background_agent'
                  created_at timestamptz default now())
```

Indexes: `ai_messages(conversation_id, created_at)`, `ai_usage_events(tenant_id, created_at)`.
Apply LOCAL only via the project's local migrate path (`scripts/migrate-apply.sh local` or equivalent) — **never** stage/prod. Record in the local ledger. `ai_usage_events` is the billing/budget source of truth (not the LLM provider dashboard) — it's created now, populated in 1B.

---

## Step 6 — Security guardrail (ESLint)

Add a `no-restricted-imports` rule scoped to `src/lib/ai/**` banning `@/lib/supabase/server`'s `createServiceClient` (and the raw path). AI code touches tenant data **only** through `scopedClient`. Verify the rule fires by temporarily importing it in a scratch file (then delete).

---

## Step 7 — Unit tests (Vitest)

If Vitest isn't wired yet, stand up the minimal config (this seeds the Phase-1 `Test` CI job later). Tests for `registry.ts` using **fixture tools** (no real tools, no LLM):
- registering a `scope:"write"` fixture **throws**;
- `buildToolset` **excludes** a tool whose `industries` don't include the auth's industry, **includes** a universal tool;
- (if permission filtering was wired) excludes a tool whose `requiredPermission` the auth lacks;
- a fixture tool's `inputSchema` rejects a bad payload (zod failure path returns a validation error, doesn't throw uncaught).

---

## Step 8 — Feature flag

`AI_ASSISTANT_ENABLED` (env, default off in prod). Add a tiny helper `isAssistantEnabled()` in `src/lib/ai/` (or reuse the existing flag/entitlement pattern if one exists — check first). 1A only defines it; 1B/1C gate on it.

---

## Verification (report these back with evidence)

1. `npm run build` clean (`NODE_OPTIONS=--max-old-space-size=5632` on this box).
2. `npx vitest run` (or project test cmd) — registry tests green; paste output.
3. `git diff --stat` confined to: `src/lib/ai/**`, the one migration file, `.eslintrc*`, `package.json`/`-lock`, test files, and the one doc note. **Nothing under `src/industries/`, `src/components/`, or the existing chat route.**
4. `package.json` diff = only `ai @ai-sdk/openai @ai-sdk/anthropic zod` (no `langfuse`, no others).
5. Migration applied LOCAL: show `\dt ai_*` (3 tables) + the RLS policies + ledger line.
6. Grep proof: `grep -rn "createServiceClient" src/lib/ai/` → **no hits**; ESLint rule present.
7. Existing mock chat route **unchanged** (`git diff` on it = empty).
8. Confirm the provider seam: with `ANTHROPIC_API_KEY` unset, `ACTIVE_PROVIDER === "openai"`; setting it flips to `"anthropic"` (a 2-line node/tsx check is fine).

## Report format
Files changed (path — one-line why), the 8 verification results with pasted evidence, any `TODO(1B)` left (esp. the permission-resolver hookup), and anything the brief got wrong about the codebase. **Do not merge, no PR, no stage/prod DB.** Opus reviews before 1B.

## Tenant-isolation reminders (non-negotiable)
- Every AI tool (1B+) executes through `scopedClient(ctx.auth)` — the ESLint rule enforces it.
- New tables have `tenant_id` FK + RLS via the SECURITY DEFINER helpers.
- `tenantId` is never taken from model output; tool results are untrusted data.
