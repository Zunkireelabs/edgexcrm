# Knowledge Bases — Implementation Brief (v1)

> **For the implementing (Sonnet) session.** Self-contained. Build exactly this. The Sonnet handoff prompt is the fenced block at the very bottom — Sadin pastes it. Plan approved by Sadin 2026-06-03.

---

## What we're building & why

A reusable **Knowledge Bases** library. Users create named knowledge bases and add **files, links, and text notes** to them, so important docs live in one place and are reusable. Later, when **Orca** (our AI layer) ships, AI agents will reference these — but **embeddings/vector retrieval are OUT of scope here**; v1 is storage + CRUD with an AI-ready schema only.

Modeled on StackAI: list page (grid/list, search, "New Knowledge Base") → create modal (name) → detail page with a documents table + ingestion options (upload file / add link / add note).

### Locked decisions (do not re-litigate)
- **Universal feature** — available to ALL industries. In our architecture that means **NO** `manifest.ts`/`_registry.ts` registration and **NO** `getFeatureAccess()` gating. It lives in `src/app/(main)/(dashboard)/knowledge-bases/` + `src/components/dashboard/`, with a hardcoded sidebar item. Mirror `team`/`pipeline` (ungated), **NOT** `check-in`/`forms` (gated).
- **Source types:** `file` + `link` + `note` only. Defer StackAI's "Import from a Connection", "Import from a Website", and the Evaluate/References tabs.
- **Permissions:** owners/admins create/edit/delete KBs and items; all members (incl. counselors) browse + download. (Matches the accounts/utm-links RLS convention.)
- **Standalone library** — NOT attached to leads/contacts/pipelines. No join tables.

---

## 1. Migration — `supabase/migrations/029_knowledge_bases.sql` (new)

029 is the next number (028 is the highest today). Follow the exact RLS style of `027_utm_links.sql`. Helpers `get_user_tenant_ids()` and `is_tenant_admin(p_tenant_id UUID)` already exist (defined in `001_initial_schema.sql`) — just call them.

```sql
-- 029_knowledge_bases.sql
-- Universal feature: org-level reusable knowledge libraries. Each KB holds
-- items of type file | link | note. Future Orca agents will reference these;
-- embeddings/pgvector are OUT of scope for this migration (future-ready only).
--
-- MANUAL SETUP REQUIRED (not done by this migration — storage buckets are
-- created in Supabase directly, per the 001_initial_schema.sql convention):
--   INSERT INTO storage.buckets (id, name, public)
--   VALUES ('knowledge-base-files', 'knowledge-base-files', false);
--   -- private bucket, file_size_limit >= 25 MiB, NO anon policies.
--   -- Access is exclusively via service-role signed URLs from admin-gated routes.

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_bases_tenant_created
  ON knowledge_bases (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_base_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('file','link','note')),
  -- future-ready for the embedding pipeline AND drives the UI "Status" column.
  -- v1 always writes 'ready'.
  status            TEXT NOT NULL DEFAULT 'ready'
                    CHECK (status IN ('pending','processing','ready','failed')),
  title             TEXT NOT NULL,
  storage_path      TEXT,    -- file only
  file_name         TEXT,    -- file only (original upload name)
  mime_type         TEXT,    -- file only
  size_bytes        BIGINT,  -- file only (drives rolled-up size)
  url               TEXT,    -- link only
  content           TEXT,    -- note only
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kb_items_tenant_created
  ON knowledge_base_items (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_items_kb
  ON knowledge_base_items (knowledge_base_id, created_at DESC);

ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base_items ENABLE ROW LEVEL SECURITY;

-- knowledge_bases: members read, admins mutate
CREATE POLICY "kb_select" ON knowledge_bases
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "kb_insert" ON knowledge_bases
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "kb_update" ON knowledge_bases
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "kb_delete" ON knowledge_bases
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- knowledge_base_items: same convention
CREATE POLICY "kb_items_select" ON knowledge_base_items
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "kb_items_insert" ON knowledge_base_items
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "kb_items_update" ON knowledge_base_items
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "kb_items_delete" ON knowledge_base_items
  FOR DELETE USING (is_tenant_admin(tenant_id));
```

**Notes:** RLS is defense-in-depth — all routes use service-role `scopedClient`, so the primary gate is app-layer `requireAdmin(auth)`. `knowledge_base_items` carries its own `tenant_id` (denormalized) so `scopedClient` + RLS work on it directly. Migration files do NOT auto-apply — Sadin/Opus applies it to the shared Supabase project + creates the bucket before smoke (see §7).

---

## 2. Storage

- **New private bucket `knowledge-base-files`** (NOT the existing `lead-documents`). Created manually in Supabase (setup SQL is in the migration header above). Private → serve downloads via short-lived signed URLs.
- **Path scheme:** `${tenantId}/${kbId}/${itemId}.${ext}` — tenant UUID first (clean orphan listing), `itemId` is generated server-side at upload-url time and carried through to register (idempotency).
- **Limits / accepted types** — define a shared const, e.g. in a small `src/lib/knowledge-base/constants.ts`:
  ```ts
  export const KB_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
  export const KB_ACCEPTED_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", // PPTX
    "image/jpeg", "image/png", "image/webp",
  ] as const;
  ```
  Validate size + MIME at BOTH the `upload-url` route AND the item-register POST (never trust the client).
- **Do NOT reuse `/api/v1/upload`** — that route is unauthenticated (anonymous public-form submitters), per-IP rate-limited, and validates against per-tenant config. Build a new authenticated, admin-gated upload-url route instead. Reuse only the *mechanism* (`createSignedUploadUrl` server-side; client `uploadToSignedUrl`).
- **Storage cleanup is the app's job** — DB cascade deletes rows, not blobs. On file-item DELETE and on KB DELETE, call `supabase.storage.from("knowledge-base-files").remove([...paths])`. Log failures; do NOT block the row delete on a storage failure (orphan-tolerant; orphan-sweep is a future follow-up).

### Confirmed signed-upload mechanism (reference: `src/components/form/public-form.tsx:291-337`)
Server returns `{ signed_url: signedData.signedUrl, token: signedData.token, path }` from `supabase.storage.from(bucket).createSignedUploadUrl(path)`. Client does:
```ts
const supabase = createClient(); // from "@/lib/supabase/client"
await supabase.storage.from("knowledge-base-files").uploadToSignedUrl(path, token, file);
```

---

## 3. API routes — `src/app/(main)/api/v1/knowledge-bases/`

**Canonical route skeleton** (every route): `createRequestLogger` → `authenticateRequest()` (→ `apiUnauthorized()` if null) → mutations add `if (!requireAdmin(auth)) return apiForbidden()` → parse JSON (catch → `apiValidationError({ body: ["Invalid JSON body"] })`) → `validate(body, rules)` (→ `apiValidationError(errors)`) → `const db = await scopedClient(auth)` → response helper. **No `getFeatureAccess`** (universal). Emit audit + event on every mutation (fire-and-forget `Promise.all`, do not await-block the response).

**Confirmed signatures:**
- `authenticateRequest()` → `AuthContext { userId, email, tenantId, role, industryId }` (from `@/lib/api/auth`).
- `requireAdmin(auth): boolean` and `getClientIp(request): string` — `@/lib/api/auth`.
- `scopedClient(auth)` (`@/lib/supabase/scoped`): `db.from(t).select(cols, opts?)` / `.insert(row)` / `.update(vals)` / `.delete()` (auto `tenant_id`; **UPDATE/DELETE MUST chain an explicit `.eq("id", x)`** — wrapper only adds the tenant filter). `db.raw()` returns the unwrapped service client (use for the aggregate rollup + storage ops). `.insert()` returns the PostgREST builder, so chain `.select().single()`.
- Validators (`@/lib/api/validation`): `validate`, `required(name)`, `isUUID()`, `isIn(arr)`, `maxLength(n)`, `optionalMaxLength(n)`, `isPositiveInt()`. **No URL validator** — add one locally:
  ```ts
  const isHttpUrl = (): ((v: unknown) => string | null) => (v) => {
    if (!v || typeof v !== "string") return null;
    try { const u = new URL(v); return (u.protocol === "http:" || u.protocol === "https:") ? null : "Must be an http(s) URL"; }
    catch { return "Invalid URL"; }
  };
  ```
- Response helpers (`@/lib/api/response`): `apiSuccess(data, status?)`, `apiValidationError(errors)`, `apiUnauthorized()`, `apiForbidden()`, `apiNotFound(name)`, `apiError(code, msg, status)`, `apiServiceUnavailable(msg)`.
- Audit/events (`@/lib/api/audit`): `createAuditLog({ tenantId, userId, action, entityType, entityId, changes?, ipAddress?, userAgent?, requestId? })` and `emitEvent({ tenantId, type, entityType, entityId, payload?, requestId? })`.

**Reference routes to mirror:** `src/app/(main)/api/v1/accounts/route.ts` (GET list + batch rollup + POST create) and `src/app/(main)/api/v1/leads/[id]/route.ts` (GET/PATCH/DELETE + audit diff). `[id]` params are async: `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params;`.

### Routes

**`route.ts`** — `/api/v1/knowledge-bases`
- **GET** (all members): `db.from("knowledge_bases").select("*").order("created_at", { ascending: false })`. Then one rollup over `db.raw()`:
  `raw.from("knowledge_base_items").select("knowledge_base_id, size_bytes").eq("tenant_id", auth.tenantId)` → reduce in JS into `{ [kbId]: { item_count, total_size_bytes } }` (sum coalescing null size to 0). Merge onto each KB as `item_count` + `total_size_bytes`. Return `apiSuccess(list)`. (PostgREST has no easy GROUP-BY via the JS client; the in-JS reduce is the accepted pattern, same spirit as accounts batch-count.)
- **POST** (admin): validate `{ name: [required("name"), maxLength(255)], description: [optionalMaxLength(2000)] }`. `db.from("knowledge_bases").insert({ name: name.trim(), description: description?.trim() ?? null, created_by: auth.userId }).select().single()`. Emit `knowledge_base.created`. `apiSuccess(created, 201)`.

**`[id]/route.ts`** — `/api/v1/knowledge-bases/[id]`
- **GET** (all): fetch KB `.select("*").eq("id", id).single()` (scoped) → `apiNotFound("Knowledge base")` if missing. Fetch items `db.from("knowledge_base_items").select("*").eq("knowledge_base_id", id).order("created_at", { ascending: false })`. Compute `item_count` + `total_size_bytes`. Return `apiSuccess({ ...kb, items, item_count, total_size_bytes })`.
- **PATCH** (admin): whitelist `name` (`maxLength(255)`) + `description` (`optionalMaxLength(2000)`) only. Build update payload from provided fields; if empty → `apiValidationError`. `db.from("knowledge_bases").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", id).select().single()`. Build a changes diff (pattern from leads PATCH) → `createAuditLog("knowledge_base.updated", { changes })` + `emitEvent`. `apiSuccess(updated)`.
- **DELETE** (admin): verify KB exists. List file items: `db.from("knowledge_base_items").select("storage_path").eq("knowledge_base_id", id).eq("type", "file")` → collect non-null paths → `db.raw().storage.from("knowledge-base-files").remove(paths)` (log failure, don't block). `db.from("knowledge_bases").delete().eq("id", id)` (cascade removes item rows). Emit `knowledge_base.deleted`. `apiSuccess({ id, deleted: true })`.

**`[id]/items/route.ts`** — `/api/v1/knowledge-bases/[id]/items`
- **GET** (all): items for the KB (scoped + `.eq("knowledge_base_id", id)`).
- **POST** (admin): verify parent KB exists in tenant first. Branch on `body.type`:
  - `link`: validate `{ title: [required, maxLength(255)], url: [required("url"), isHttpUrl()] }`. Insert `{ type: "link", knowledge_base_id: id, title, url, status: "ready", created_by: auth.userId }`.
  - `note`: validate `{ title: [required, maxLength(255)], content: [required("content"), maxLength(50000)] }`. Insert note row (`type: "note"`, `content`).
  - `file`: validate `{ item_id: [required, isUUID()], title: [required], file_name: [required], mime_type: [required, isIn([...KB_ACCEPTED_TYPES])], size_bytes: [required, isPositiveInt()], storage_path: [required] }`. Re-check `size_bytes <= KB_MAX_FILE_BYTES`. **Idempotency:** insert with explicit `id: item_id`; on unique-violation (duplicate `id`) treat as success (the row already exists from a retried register). Insert `{ id: item_id, type: "file", knowledge_base_id: id, title, file_name, mime_type, size_bytes, storage_path, status: "ready", created_by: auth.userId }`.
  - else → `apiValidationError({ type: ["Must be one of: file, link, note"] })`.
  - Emit `knowledge_base_item.created` (payload `{ type }`). `apiSuccess(created, 201)`.

**`[id]/items/[itemId]/route.ts`**
- **PATCH** (admin): whitelist per type — `title` always; `note` also `content`; `link` also `url` (`isHttpUrl()`). `.eq("id", itemId)`. Audit `knowledge_base_item.updated`.
- **DELETE** (admin): read row (`type`, `storage_path`); if `type === "file"` && `storage_path` → `db.raw().storage.from("knowledge-base-files").remove([storage_path])` (log, don't block). `db.from("knowledge_base_items").delete().eq("id", itemId)`. Emit `knowledge_base_item.deleted`.

**`[id]/upload-url/route.ts`**
- **POST** (admin): validate `{ file_name: [required], file_size: [required, isPositiveInt()], mime_type: [required, isIn([...KB_ACCEPTED_TYPES])] }` + `file_size <= KB_MAX_FILE_BYTES`. Verify KB exists in tenant. `const itemId = crypto.randomUUID()`; `const ext = String(file_name).split(".").pop() || "bin"`; `const path = \`${auth.tenantId}/${id}/${itemId}.${ext}\``. `db.raw().storage.from("knowledge-base-files").createSignedUploadUrl(path)`. Return `apiSuccess({ signed_url: signedData.signedUrl, token: signedData.token, path, item_id: itemId })`. No audit (the items POST records it on successful register).

**`[id]/items/[itemId]/download/route.ts`**
- **GET** (all members): read the item (scoped, `.eq("id", itemId)`); 404 if missing or not a file. `db.raw().storage.from("knowledge-base-files").createSignedUrl(storage_path, 60)` → `apiSuccess({ url: signed.signedUrl })`.

---

## 4. Frontend — `src/components/dashboard/`

Server page shells delegate to `"use client"` components (the `team` pattern). Use shadcn `Dialog`, `Input`, `Label`, `Button`, `Table`, `Badge`, `DropdownMenu`; toasts via `sonner` (`import { toast } from "sonner"`). Refresh = local state + refetch after mutations (matches existing dashboard components — no global cache lib). `isAdmin = role === "owner" || role === "admin"`; hide all create/edit/delete controls when `!isAdmin` (server still enforces via `requireAdmin`).

**No existing `formatBytes` util** — add `src/lib/format.ts` (or extend an existing util file) with a small `formatBytes(n: number): string` ("0 B", "1.2 MB", …).

Components:
- **`knowledge-bases.tsx`** (list) — props `{ tenantId, role }`. State: `kbs`, `loading`, `search`, `view: "grid" | "list"`, `createOpen`. GET `/api/v1/knowledge-bases` on mount. Header: search input (client-side `.filter` on name/description), grid/list toggle, "New Knowledge Base" button (admin-only). Empty state (icon + copy + CTA, like `form-list.tsx`). Renders `KnowledgeBaseCard`s (grid) or rows (list).
- **`knowledge-base-card.tsx`** — name, description, `formatBytes(total_size_bytes)`, `item_count`, 3-dot `DropdownMenu` (Rename, Delete — admin-only). Card click → `router.push("/knowledge-bases/" + id)`.
- **`create-knowledge-base-modal.tsx`** — clone `src/components/pipeline/CreatePipelineModal.tsx` shape (Dialog + `name` field + optional `description` + POST + toast + `onClose(newId?)`). On success → `router.push("/knowledge-bases/" + newId)`.
- **`knowledge-base-detail.tsx`** — props `{ id, tenantId, role }`. GET `/api/v1/knowledge-bases/[id]`. Inline-editable name + description (admin only; blur → PATCH, optimistic). Renders `KnowledgeBaseItemsTable` + empty state with 3 CTAs: file dropzone, "Add a Link", "Add a Note".
- **`knowledge-base-items-table.tsx`** — columns: Name, Type (badge), Size (`formatBytes` for file, "—" otherwise), Status (badge), Added by/date, row actions. File rows: "Download" → GET the download route → `window.open(url)` (or anchor). Edit/Delete admin-only.
- **`add-link-dialog.tsx`** / **`add-note-dialog.tsx`** — small Dialogs POSTing to `…/items` with `type`; optimistic add to the table, toast, refetch on settle.
- **`knowledge-base-file-dropzone.tsx`** — drag-or-click. Per file: POST `…/upload-url` → `createClient().storage.from("knowledge-base-files").uploadToSignedUrl(path, token, file)` → POST `…/items` with `{ type: "file", item_id, title: file.name, file_name: file.name, mime_type: file.type, size_bytes: file.size, storage_path: path }`. Show a per-file spinner; on done, add the row.

---

## 5. Sidebar + routing

**`src/components/dashboard/shell.tsx`** — import `Library` from `lucide-react`, add to `UNIVERSAL_NAV_MIDDLE` (currently just Pipeline):
```ts
const UNIVERSAL_NAV_MIDDLE = [
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/knowledge-bases", label: "Knowledge Bases", icon: Library },
];
```
Do **NOT** touch `INDUSTRY_ICONS` (string registry, only for manifest items).

**Page shells (new):**
- `src/app/(main)/(dashboard)/knowledge-bases/page.tsx`:
  ```tsx
  import { redirect } from "next/navigation";
  import { getCurrentUserTenant } from "@/lib/supabase/queries";
  import { KnowledgeBases } from "@/components/dashboard/knowledge-bases";
  export default async function KnowledgeBasesPage() {
    const tenantData = await getCurrentUserTenant();
    if (!tenantData) redirect("/login");
    return (
      <div className="space-y-4">
        <KnowledgeBases tenantId={tenantData.tenant.id} role={tenantData.role} />
      </div>
    );
  }
  ```
  (No `getFeatureAccess`/`notFound` — universal.)
- `src/app/(main)/(dashboard)/knowledge-bases/[id]/page.tsx`: same auth; `const { id } = await params;` (params is `Promise<{ id: string }>`) → `<KnowledgeBaseDetail id={id} tenantId={tenantData.tenant.id} role={tenantData.role} />`.

---

## 6. AI-readiness (future Orca phase — confirm zero v1 schema change)

Do nothing AI-related now. The future phase is purely additive: enable `CREATE EXTENSION vector;`, add a `knowledge_base_chunks` table (`item_id REFERENCES knowledge_base_items(id) ON DELETE CASCADE`, `chunk_index`, `content`, `embedding vector(1536)`) + ANN index + same RLS, and an ingest worker that consumes the `knowledge_base_item.created` events v1 already emits and flips `status` `pending→processing→ready/failed` (column + CHECK values already exist). The v1 `status` column and event emissions are the only hooks needed — no v1 rework.

---

## 7. Edge cases / risks (handle as specified)
- **Orphaned blobs:** remove on delete (logged, non-fatal). Orphan-sweep is a future follow-up — do not build it now.
- **Idempotent file register:** `item_id` generated at upload-url time, carried to register; register keyed on `id = item_id`, duplicate-id treated as success.
- **Counselor visibility:** members pass SELECT + can download; all mutations `requireAdmin` → 403; frontend hides admin controls. KBs are NOT assignment-scoped.
- **Mixed-type validation:** items POST branches per `type`, validates only that type's fields, leaves the other type columns null. Server re-checks file MIME/size.
- **scopedClient discipline:** every UPDATE/DELETE chains an explicit `.eq("id", …)` in addition to the auto tenant filter. Storage ops use `db.raw().storage…`.

---

## 8. Build / verify (gates + smoke)
1. `npm run build` → clean.
2. `npx eslint --max-warnings 50` → **0 errors** (build alone is NOT enough — a build-clean branch has red-deployed before on a lint rule). Watch React-19 `react-hooks/set-state-in-effect` on mount effects (inline the async loader inside the effect; see existing components).
3. Migration apply + bucket creation are done by Opus/Sadin (shared project `pirhnklvtjjpuvbvibxf`) before smoke — note in the PR that both are required.
4. **Dev smoke matrix** (`dev-lead-crm.zunkireelabs.com`):
   - Admin: create KB (modal → navigates to detail) → upload a PDF (dropzone → row appears `ready` with size) → add a link → add a note → back to list, card shows correct item count + rolled-up size.
   - Non-admin member/counselor: list is read-only (no New / 3-dot / inline-edit) → can open detail + download a file.
   - Counselor direct API POST/PATCH/DELETE → 403.
   - Delete file item → row gone + blob removed from bucket. Delete KB → KB + items gone (cascade) + file blobs removed.
   - Second tenant cannot see/fetch tenant 1's KB (scopedClient + RLS).

---

## Scope guardrails for the implementer
- Build ONLY §1–§5. Do not add embeddings, vector, text extraction, the Evaluate/References tabs, connection/website import, or KB-to-record attachment.
- Default everything to the universal pattern — do NOT register anything in `_registry.ts` or any `manifest.ts`, and do NOT add a `getFeatureAccess` gate.
- New tenant-touching queries use `scopedClient(auth)`, never raw `createServiceClient()` (except `db.raw()` for the rollup aggregate + storage ops).

---

```
SONNET HANDOFF PROMPT (Sadin pastes this into a fresh Sonnet session):

Implement the Knowledge Bases feature exactly per docs/KNOWLEDGE-BASES-BRIEF.md. Read that brief in full first; it is self-contained and has every signature, file path, and reference route you need.

Branch off the latest `stage`: `git checkout stage && git pull --rebase origin stage && git checkout -b feat/knowledge-bases`.

Build in this order, committing logically as you go:
1. Migration `supabase/migrations/029_knowledge_bases.sql` (§1) — do NOT apply it; Opus applies it + creates the bucket.
2. `src/lib/knowledge-base/constants.ts` (KB_MAX_FILE_BYTES + KB_ACCEPTED_TYPES) and a `formatBytes` util (§2, §4 — none exists yet).
3. API routes under `src/app/(main)/api/v1/knowledge-bases/` (§3): `route.ts`, `[id]/route.ts`, `[id]/items/route.ts`, `[id]/items/[itemId]/route.ts`, `[id]/upload-url/route.ts`, `[id]/items/[itemId]/download/route.ts`. Mirror `accounts/route.ts` and `leads/[id]/route.ts`. Use `scopedClient(auth)`, `requireAdmin` on mutations, `validate()`, emit `createAuditLog` + `emitEvent` on mutations. NO `getFeatureAccess`.
4. Frontend components under `src/components/dashboard/` (§4) + the two page shells under `src/app/(main)/(dashboard)/knowledge-bases/` (§5).
5. Sidebar entry in `src/components/dashboard/shell.tsx` (§5): import `Library`, add to `UNIVERSAL_NAV_MIDDLE`.

Hard rules:
- This is a UNIVERSAL feature: do NOT register it in `_registry.ts` or any `manifest.ts`, and do NOT add a `getFeatureAccess`/`notFound` gate. Mirror team/pipeline, not check-in/forms.
- Permissions: all members read; owners/admins mutate (server-enforced via `requireAdmin`, UI hides controls when `role` isn't owner/admin).
- Every scopedClient UPDATE/DELETE chains an explicit `.eq("id", …)` beyond the auto tenant filter. Storage ops via `db.raw().storage…`. Validate file size/MIME on BOTH upload-url and item-register.
- Do NOT reuse `/api/v1/upload` (it's anonymous/public). Build the new admin-gated `upload-url` route; reuse only the signed-URL mechanism from `public-form.tsx`.
- Build ONLY what the brief specifies — no embeddings, no text extraction, no Evaluate/References tabs, no connection/website import, no record attachment.

Before declaring done, run BOTH gates and paste the output: `npm run build` (clean) and `npx eslint --max-warnings 50` (0 errors). Do not push to stage or open a PR to main — push the `feat/knowledge-bases` branch and stop; Opus reviews the full diff, runs the gates, and squash-merges to stage.

Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (the commit-msg hook rewrites it to the local git user).
```
