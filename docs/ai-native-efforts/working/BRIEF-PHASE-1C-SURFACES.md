# Executor Brief — Phase 1C: Surfaces & Gates (the visible assistant)

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-16
**Parent plan:** `docs/ai-native-efforts/01-PHASE-1-ASSISTANT-FOUNDATION.md` (final slice: 1A ✅ → 1B+fixup ✅ both Opus-verified live → **1C**).
**State you inherit:** real streaming multi-tool chat proven end-to-end at `/api/v1/ai/chat` (flag-gated; currently `false`). 1B+fixup are staged/uncommitted — **commit them first** (Step 0). The dashboard panel and Ask Orca page still speak the old mock JSON.

---

## What 1C is (and is NOT)

**Is:** the user-visible assistant. Wire the existing panel + Ask Orca page to the streaming route via `useChat`, conversation history (list/continue/delete), markdown + tool-activity UI, real Langfuse behind the telemetry seam, delete the mock, flip the flag on, close the small hardening/cosmetic items from 1B review, acceptance checklist, FEATURE-CATALOG update.

**Is NOT:** stage/prod promotion (VPS env, migration 160 on stage, Traefik streaming check — separate step after Sadin's demo pass), write tools, RAG, per-industry prompt packs, entitlements-table budget integration, voice, new industries work.

## Step 0 — Commit inherited work

Two commits on `feature/ai-assistant-foundation` before starting:
1. `feat(ai): Phase 1B — 8 read-only tools + streaming chat v2 (flag-gated)` — everything currently staged.
2. `fix(ai): sanitize placeholder tool args; pipeline_summary default-pipeline resolution` — the fixup files.

## Step 1 — Dependencies

```bash
npm i @ai-sdk/react langfuse
```
`@ai-sdk/react` = `useChat` (v7 — pin whatever major matches the installed `ai@7`). Markdown rendering: **check for an existing renderer first** (`grep -rn "react-markdown\|remark\|marked" src/ package.json`); if none, `npm i react-markdown remark-gfm` is approved. Nothing else.

## Step 2 — Conversations API (new, tiny)

`src/app/(main)/api/v1/ai/conversations/route.ts` + `[id]/route.ts`, standard pattern (`authenticateRequest` → `scopedClient`; **every query also filters `user_id = auth.userId`** — conversations are per-user):
- `GET /conversations` → own conversations, `id, title, created_at, updated_at`, newest-updated first, ≤50.
- `GET /conversations/[id]` → the conversation + its `ai_messages` (ordered `created_at`), own-only else 404.
- `DELETE /conversations/[id]` → own-only else 404 (FK cascades messages).
Gate all three (and keep the chat route consistent): if `!isAssistantEnabled()` → 404-shape response, so surfaces can't half-work with the flag off.

## Step 3 — Panel rewrite (`src/components/dashboard/ai-assistant-panel.tsx` + `ai-assistant/` sub-components)

Replace the fetch-JSON logic with `useChat` from `@ai-sdk/react` (v7: `DefaultChatTransport` with `api: "/api/v1/ai/chat"`; the transport already sends `{id, messages}` — the route treats `id` as conversationId; generate a fresh UUID per new chat, pass it as the chat `id`).
- **Streaming text** renders incrementally; **markdown** rendered (links, bold, lists — tool outputs deep-link `/leads/<id>` etc.).
- **Tool-activity indicator:** while a tool part is in-flight show a small line like "Searching leads…" (map tool ids → friendly labels: search_leads "Searching leads", get_lead "Looking at a lead", pipeline_summary "Summarizing pipeline", list_my_tasks "Checking tasks", team_lookup "Checking the team", activity_timeline "Reading activity", search_knowledge "Searching knowledge", get_form_submissions_summary "Checking form submissions").
- **Error + retry:** stream error part → inline error bubble + a Retry button (re-submit last user message).
- **History:** a header dropdown/menu listing conversations (from Step 2), "New chat" action, per-conversation delete with confirm. Selecting one loads its messages (map stored rows → UIMessages; stored assistant `content` is `{text, toolCalls}` — render the `text`).
- Keep: `AIAssistantProvider` open/close, expand/collapse, Escape-to-close, welcome message (shown only for an empty new chat), "Powered by Zunkiree AI" branding, the accuracy footer.
- Keep the panel working when the flag is off? No — 1C flips the flag ON and **deletes the mock**; if `AI_ASSISTANT_ENABLED` is false the panel should show a quiet "Assistant is not enabled" state (probe: first send returns the 404-shape → show that state). Don't build two UIs.

## Step 4 — Ask Orca page (`src/components/dashboard/orca/ask-orca-content.tsx`)

Same chat brain, second surface: replace the inert composer with the SAME chat component/hook (extract the message-list + input into a shared component under `src/components/dashboard/ai-assistant/` so panel and page don't fork). The 4 suggestion chips become real prompts (clicking sends that text). One brain, two surfaces — no separate state store.

## Step 5 — Delete the mock + flag on

- Delete `src/app/(main)/api/v1/ai/chat/mock.ts` and the flag-off mock branch; grep proves no `MOCK_RESPONSES`/`generateMockResponse` remnants anywhere.
- The route's flag-off behavior becomes the 404-shape response (Step 2).
- Set `AI_ASSISTANT_ENABLED=true` in local `.env.local` and LEAVE it on — the UI now speaks streaming.

## Step 6 — Langfuse behind the seam (`src/lib/ai/telemetry.ts`)

Swap the no-op body for Langfuse **behind the SAME interface** (callers in route/adapter don't change — that was the whole point of the seam):
- `startTrace(meta)` → creates a Langfuse trace (id = runId, tags/metadata: tenantId, userId, industryId, surface); `span(name, data)` → child span/event; `end(data)` → finalize + flush appropriately for serverless/route context (check langfuse SDK docs for Next.js route usage — likely `flushAsync`/`shutdownAsync` or the `after()` pattern; do NOT block the stream on flushing).
- **Graceful no-op when `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` are unset** — local dev without keys must behave exactly like 1B. Env: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (default `https://cloud.langfuse.com`). **Sadin owes a free Langfuse account + keys** — if absent at verification time, prove the no-op path and mark the trace screenshot item BLOCKED: keys.
- Add generation-level data where cheap (model, token usage in `trace.end`) — full generation spans can deepen later; don't gold-plate.

## Step 7 — Small items owed from 1B review (do these, they're tiny)

1. **Conversation-insert hardening:** in the chat route, if the `ai_conversations` insert errors (e.g. client-supplied id collides cross-tenant), regenerate a server-side UUID, retry once, and use THAT id for persistence (return it in the stream metadata if the SDK supports it; otherwise log).
2. **Prompt cosmetics** (`prompts/assistant.ts`): add — links returned by tools are **relative paths** (`/leads/<id>`); render them as markdown links **without inventing a domain**.
3. **`userFirstName`:** panel/page now pass the logged-in user's display name via the transport body (`body: {name}`), route uses it over the email-prefix fallback. (Client has it; keep the fallback.)

## Step 8 — Tests

- Conversations API: ownership (user A cannot GET/DELETE user B's conversation — unit-test the handler logic or cover via the route's user_id filter with a mocked db), flag-off 404 shape.
- Telemetry: keys unset → no-op (no throw, no network); keys set → trace object created (mock the SDK).
- Keep 67 green; extend the prompt test for the relative-links line.
- UI: no component test runner is configured for interactive streams — skip UI unit tests; the visual pass covers it.

## Verification (report with evidence)

1. Build + lint + vitest green (heap flag).
2. Diff scope: `src/lib/ai/**`, chat route dir (mock DELETED), new conversations routes, `ai-assistant-panel.tsx` + `ai-assistant/` sub-components, `ask-orca-content.tsx`, package.json (only the approved deps), FEATURE-CATALOG, docs note. **Nothing in `src/industries/`, no migrations.**
3. Grep: zero `MOCK_RESPONSES|generateMockResponse` hits; zero `createServiceClient` under `src/lib/ai/`.
4. Live curls (flag on, cookie recipe in the 1B fixup brief): chat still streams multi-tool for `owner@cre-capital.local`; `GET /conversations` lists the chats with titles; `GET /conversations/<id>` returns messages; cross-user DELETE → 404 (use `counselor@admizz.local` against an owner conversation id — note: different tenant AND user, both must fail).
5. Langfuse: with keys → a full trace for a multi-tool conversation visible in the dashboard (screenshot/URL); without keys → prove requests still work (this is the no-op path).
6. `FEATURE-CATALOG.md`: `ai-assistant` row mock → real (universal, all industries, flag-gated).
7. State plainly what needs the human visual pass (panel streaming, tool-activity lines, history dropdown, Ask Orca chips) — the box is headless; Sadin tunnels to :3000.

## Report format
Same as 1A/1B. No merge, no PR, no stage/prod. Opus reviews; then the promotion plan (stage env keys, migration 160 on stage, Traefik streaming check) is a separate Opus-planned step.

## Tenant-isolation reminders
- Conversations/messages: every route query filters BOTH `tenant_id` (scopedClient) AND `user_id = auth.userId`.
- The UI never sends tenant/user ids — they come from the session.
- Tool results remain untrusted data; nothing a tool returns is executed or navigated to automatically.
