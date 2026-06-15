# Domain Migration Brief — `lead-crm.zunkireelabs.com` → `edgex.zunkireelabs.com`

**Status:** In-flight — ✅ Phase 0 + ✅ Phase 1 DONE (2026-06-15, `main` @ `cdc84f9`, edgex LIVE dual-host); ⏳ Phase 2 (drain) + Phase 3 (308 redirect → remove lead-crm) pending.
**Author:** Opus (planning session) · **Executor:** Sonnet for code, Sadin for manual/external steps · **Reviewer:** Opus
**Created:** 2026-06-14 · **Updated:** 2026-06-15

---

## 📍 PHASE 2 CHECKPOINT — call sign `EDGEX-DRAIN` (paused 2026-06-15)

> Say **"resume EDGEX-DRAIN"** to pick up here. Phase 0+1 LIVE; Phase 2 investigation done; paused before the placement re-point work. No prod state changed since `cdc84f9`.

**Where we are:** Sonnet ran the Phase 2 read-only investigation (full report in SESSION-LOG 2026-06-15). Opus reviewed it against the code and found one interpretation error that *shrinks* the Phase-3 risk surface. Nothing has been re-pointed yet; no Traefik change made.

**Established facts (verified):**
- **10 live forms** — Admizz: `registration-form`, `worldcup-predict-win`, `test-prep`, `enquiry`, `find-your-destination`, `spin-win`, `uk-education-expo-2026` (+ `test-form-2` dormant, 0 leads). Prime (`prime-ceramics`): `download-catalogue`, `request-a-quote`. Before/after URL tables in the SESSION-LOG report.
- **Dead key confirmed:** Admizz `Orca-connection` integration key (`{admin}` scope, last used 2026-03-06, 101d idle, 0 idempotency rows, 0 integration leads) → **safe for Phase 3**. The `Form V2` key (category `form`) is HOT (used daily).
- **Zero in-repo / in-DB placements.** All `form_configs.redirect_url` NULL; no lead-crm URL literal in any tenant/form DB field; only intentional code refs (Traefik rule, `PLATFORM_EMAIL_HOST` which stays lead-crm) + docs. Every placement is **external**.
- **Traefik access logging is OFF** (`/home/zunkireelabs/traefik/traefik.yml` has no `accessLog:` block) → cannot measure per-host drain today.

**Opus correction (the key insight — changes the risk surface):** there are **two ingestion channels, distinguished by endpoint, NOT by `intake_source`** (`intake_source` is a UTM/attribution label, not a channel signal):
- **Hosted form** → `POST /api/v1/leads` (public, no key); `events` payload has **no `source`**. → **Fully 308-safe** (GET `/form/...` → 308 → browser follows → page loads from edgex → same-origin submit). **Re-pointing optional, does NOT gate Phase 3.**
- **API integration** → `POST /api/public/submit/...` (Bearer key); `events.payload->>'source' = 'public_api'`. → **The ONLY Phase-3 risk** (a server-side POST that may not follow a 308; 308 *does* preserve method+body, so only clients configured not-to-follow-on-POST break). **Only these callers must be re-pointed/verified before Phase 3.**

**NEXT STEP when resumed (drafted, not yet run):** a tight read-only Sonnet follow-up to get ground truth instead of `intake_source` guesses —
- (A) definitive per-form channel split via `events`→`leads`→`form_configs` (resolve form via `leads.form_config_id`; hosted event payload lacks `form_slug`). Forms with `api_posts>0` = the real Phase-3 risk list.
- (B) caller fingerprint (IP / user-agent / key) for api-channel forms only — to identify WHO controls each caller. (Note: `audit_logs 'lead.created'` is suppressed when a `lead.submission` audit is written — check `lead.submission` rows / any `lead_submissions` table.)
- (C) list hosted-only forms (`api_posts=0`) explicitly as "308-safe, no re-point."
- The full follow-up prompt is in the chat that produced this checkpoint.

**Then, the only open question per api-channel form:** do we control / can we contact the caller to switch its base URL to edgex? If yes for all → 308 is a pure safety net, likely **skip the Traefik restart**. If any caller is third-party/unknown → enable access logging to **stdout (`docker logs traefik`, no volume mount, sub-second restart at low-traffic)** during the soak to catch silent 308 non-followers. **Phase 3 is still a separate explicit GO.**

---

## ⚠️ EXECUTION PROTOCOL — ONE STEP AT A TIME, SCREENSHOT-VERIFIED

**This migration moves strictly one step at a time. No step begins until the previous step is confirmed done and correct.**

- Sadin executes each manual step (DNS, Google Cloud Console, Supabase, verification curls, etc.), then **sends a screenshot** of the result.
- **Claude must verify that screenshot against the step's expected state** before either party advances. Claude states explicitly "✅ verified — proceed to step N+1" or "❌ mismatch — here's what's wrong" — never assume a step succeeded.
- This is non-negotiable for **Phase 0** (Google OAuth redirect URIs, Supabase redirect allow-list, DNS): a wrong or missing entry there silently breaks OAuth or auth-email links *after* the cutover, when it's hardest to diagnose.
- Code changes (Phase 1/3) follow the normal gate: Sonnet edits → Opus reviews the diff → stage → CI → main. Never a manual `docker compose` on the box (prod-compose landmine — bare `docker compose` clobbers prod; use CI/CD or `-f docker-compose.prod.yml`).

---

## Goal

Make `edgex.zunkireelabs.com` the sole production domain, with `lead-crm.zunkireelabs.com` eventually decommissioned — **without any client noticing a single broken request.**

## Why this can't be an instant cut (the finding)

Read-only audit of the shared prod DB (2026-06-14):

| Tenant | Leads (30d) | Last lead | Form key last used |
|---|---|---|---|
| **Admizz Education** | **337** | **2026-06-14 (today)** | today |
| Prime Ceramics | 17 | 2026-06-09 | 2026-06-09 |
| Zunkiree Labs | 11 | 2026-06-10 | — |
| Arya Travels | 10 | 2026-06-09 | — |

The embed iframe `src` is built from `window.location.origin` (`src/components/dashboard/settings-form.tsx:141-145`). The dashboard runs on lead-crm, so **every embed/share already in the wild contains the lead-crm URL** — a string living in the client's HTML / share materials, which we cannot edit remotely. Turning lead-crm off instantly blanks Admizz's live form. Therefore the cutover requires a short transition window where both hosts answer; it still ends edgex-only.

## Decisions locked (2026-06-14)

- **End state:** lead-crm becomes a **308 redirect → edgex**, then removed once traffic hits zero. (Not removed instantly; not kept forever.)
- **Embed control:** *we* control where Admizz/Prime forms are placed → we silently re-point them to edgex in Phase 2; the 308 redirect is a safety net for stray bookmarks.
- **Email from-address:** stays on the verified `noreply@lead-crm.zunkireelabs.com` — **out of scope** for this migration. Moving it to `@edgex` needs separate Resend domain verification (DKIM/SPF) and is a later Phase 2-email task. Email *links* still move to edgex (driven by `APP_URL`).

---

## Phase 0 — Manual pre-flight (Sadin; gates everything; harmless to live site)

Each step → screenshot → Claude verifies → next.

1. **DNS + port 80 reachable** (so Let's Encrypt HTTP-01 issues the edgex cert):
   ```
   dig +short edgex.zunkireelabs.com        # expect: 94.136.189.213
   curl -I http://edgex.zunkireelabs.com    # expect: a response from the VPS, not a timeout
   ```
   Screenshot: terminal output. Verify A-record == VPS IP and HTTP reaches Traefik.

2. **Google Cloud Console** → APIs & Services → Credentials → OAuth 2.0 client → **Authorized redirect URIs** → *add* (keep existing lead-crm URIs):
   - `https://edgex.zunkireelabs.com/api/v1/settings/email-accounts/gmail/callback`
   - `https://edgex.zunkireelabs.com/api/v1/email/inboxes/callback`
   Screenshot: the redirect-URI list. Verify both edgex URIs present AND old ones retained.

3. **Supabase** → Authentication → URL Configuration → **Redirect URLs** → *add* `https://edgex.zunkireelabs.com/**` (keep lead-crm). **Leave Site URL on lead-crm for now.**
   Screenshot: the Redirect URLs list. Verify edgex wildcard present, Site URL unchanged.

**Do not start Phase 1 until all three Phase-0 screenshots are verified.**

---

## Phase 1 — edgex canonical, both hosts serve the same container (code → CI)

Sonnet edits, Opus reviews diff, normal stage→main→CI deploy.

**`docker-compose.prod.yml`:**
- Build arg: `NEXT_PUBLIC_APP_URL: https://edgex.zunkireelabs.com` (was lead-crm). *Build-time baked — requires the CI rebuild.*
- Both router rules → serve both hosts:
  ```
  - "traefik.http.routers.leads-crm-secure.rule=Host(`edgex.zunkireelabs.com`) || Host(`lead-crm.zunkireelabs.com`)"
  - "traefik.http.routers.leads-crm.rule=Host(`edgex.zunkireelabs.com`) || Host(`lead-crm.zunkireelabs.com`)"
  ```
  (certresolver=letsencrypt will request a cert covering both SANs.)

**Code:**
- `src/lib/email/index.ts`: `APP_URL` fallback default → `https://edgex.zunkireelabs.com`. Introduce one shared `PLATFORM_EMAIL_HOST = "lead-crm.zunkireelabs.com"` constant and derive `EMAIL_FROM` from it; refactor `src/lib/email/sender.ts` `PLATFORM_ADDRESS` and `src/app/(main)/api/v1/settings/email-rules/[id]/test/route.ts:63` to use it — kills the 3-way host literal drift. (Value stays lead-crm.)
- `src/components/dashboard/api-keys-manager.tsx:434,451`: displayed integration endpoint → edgex.
- `.github/workflows/deploy.yml:77` + `rollback.yml:52`: health-check curl → edgex.
- (Low priority / cosmetic) `docs/reference/api-contracts/openapi.json`, `genxcrm_postman_collection.json` base URLs → edgex.

**Verify after deploy (screenshot each):**
- `curl -I https://edgex.zunkireelabs.com/login` → 200 + valid (non-self-signed) TLS.
- `curl -I https://lead-crm.zunkireelabs.com/login` → still 200.
- Gmail connect flow on edgex completes (OAuth redirect resolves).
- Trigger a test invite → link points to edgex and loads.

**Zero client impact in this phase** — all existing lead-crm embeds keep working.

---

## Phase 2 — silent drain (we control placement)

- Re-point Admizz + Prime form embeds/links to the **edgex** form URL wherever we surface them.
- Confirm the Admizz **integration key** (last used 2026-03-06) is dead or migrated — a server-side integration POSTing directly to lead-crm is the one thing a 308 can't always save (some clients don't follow redirects on POST).
- Watch the old host drain. Per-host traffic check (Traefik access log on the VPS, via `ssh vps`):
  ```
  # count requests still hitting the lead-crm Host header in the live log
  ```
  (Executor to supply the exact log path/grep at run time.) Proceed to Phase 3 only when lead-crm form/API traffic is effectively zero.

---

## Phase 3 — hard cut: lead-crm → 308 → edgex, then remove

**`docker-compose.prod.yml`** — split the routers: edgex serves the app; lead-crm becomes a permanent redirect (keeps its TLS cert so the HTTPS hit can redirect):
```
# edgex — serves the app
- "traefik.http.routers.edgex-secure.entrypoints=websecure"
- "traefik.http.routers.edgex-secure.rule=Host(`edgex.zunkireelabs.com`)"
- "traefik.http.routers.edgex-secure.tls=true"
- "traefik.http.routers.edgex-secure.tls.certresolver=letsencrypt"
# lead-crm — 308 redirect to edgex (both entrypoints; keep TLS for the https hit)
- "traefik.http.routers.leadcrm-redir-secure.entrypoints=websecure"
- "traefik.http.routers.leadcrm-redir-secure.rule=Host(`lead-crm.zunkireelabs.com`)"
- "traefik.http.routers.leadcrm-redir-secure.tls=true"
- "traefik.http.routers.leadcrm-redir-secure.tls.certresolver=letsencrypt"
- "traefik.http.routers.leadcrm-redir-secure.middlewares=to-edgex"
- "traefik.http.middlewares.to-edgex.redirectregex.regex=^https?://lead-crm\\.zunkireelabs\\.com/(.*)"
- "traefik.http.middlewares.to-edgex.redirectregex.replacement=https://edgex.zunkireelabs.com/${1}"
- "traefik.http.middlewares.to-edgex.redirectregex.permanent=true"
```
(Executor finalizes exact label syntax + the `web`→`websecure` redirect router for lead-crm.)

- Transparent: an embedded `GET /form/...` follows the 308, loads from edgex, and all its submits then originate from edgex.
- **Verify:** `curl -I https://lead-crm.zunkireelabs.com/form/admizz/<slug>` → 308 with `Location: https://edgex.zunkireelabs.com/...`; the live form still loads end-to-end.
- Once lead-crm traffic = 0, **remove the lead-crm router entirely**. End state: edgex is the only domain.

---

## Risks / guardrails

- **Compressing phases is the only real failure mode** — Admizz's live form (a lead today) is the canary. One step at a time.
- `NEXT_PUBLIC_APP_URL` is **build-time baked** — the change only takes effect on the CI rebuild, not a container restart.
- **Don't hard-switch the Supabase Site URL on day one** — add edgex to the allow-list first; switch the primary Site URL only after a soak, so a misconfig can't break password-reset/confirm links.
- **Let's Encrypt:** if edgex DNS isn't propagated or port 80 is blocked, the cert fails and edgex serves a bad cert — that's exactly why Phase 0 step 1 is verified first.
- **Never** `docker compose` bare on prod — CI/CD or `-f docker-compose.prod.yml` only.

## Rollback

- Phase 1: revert the `docker-compose.prod.yml` + code commit, redeploy via CI → back to lead-crm-only. edgex simply stops being served; no data touched.
- Phase 3: if a straggler breaks, revert the redirect router back to the Phase-1 dual-serve labels — lead-crm serves the app again immediately.

## Open follow-ups (later, not this migration)

- Move email from-address to `@edgex` (needs Resend domain verification — DKIM/SPF).
- Update `docs/reference/api-contracts/*` base URLs (cosmetic).
