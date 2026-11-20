# Website chat: go-live checklist

**Status:** draft. Nothing here has been run against stage, production or the VPS. Every step marked **[OK needed]**
changes shared or production data or servers and waits for an explicit yes from a lead. No secrets belong in this file.
Plane is not used for this work (decision of 2026-11-19).

**Order matters.** Do each phase on **stage first**, check it, then production.

## Phase 0: decisions

Answers from `CHATWOOT-DECISIONS-BRIEF.md`, especially: where Chatwoot runs (#1), the community edition and branding
check (#2), who watches unlinked chats (#3), and who holds the platform key (#8). Do not start Phase 2 before #1 and #2.

## Phase 1: prepare (read-only)

- [ ] **Check the VPS has room** for Chatwoot: free memory and disk, the ports in use, and how Traefik and the existing
      containers are set up. **[OK needed]** (a read-only look at production through `ssh vps`).
- [ ] Choose the public name for Chatwoot, for example `inbox.<domain>`, and create the DNS record.
- [ ] Decide where the secrets live (Chatwoot's, EdgeX's server settings, the Admizz deploy secrets).
- [ ] Confirm the exact Chatwoot **community edition** image to use (so the `enterprise/` code is not installed). Not verified yet.

## Phase 2: Chatwoot in production

Chatwoot runs as 4 parts: web (Rails), background worker (Sidekiq), Postgres with the pgvector extension, and Redis.

- [ ] Run it in Docker behind Traefik with HTTPS, a persistent database volume and **backups**. **[OK needed]**
- [ ] Production settings: a new random `SECRET_KEY_BASE`, `FRONTEND_URL` set to the public address, `RAILS_ENV=production`,
      account signup **off**, outbound email settings if emails are wanted.
- [ ] **Do not** set `SAFE_FETCH_ALLOW_PRIVATE_NETWORK` in production. That switch is only for local testing; in
      production, EdgeX's webhook address must be public HTTPS.
- [ ] Branding (Chatwoot's own installation settings, saved in its database): installation name and brand name
      "Zunkiree", the brand link, and the logo once available. The local values are in the developer's notes.
- [ ] Create the **platform app** and keep its token as a server secret (owner named in decision #8).
- [ ] Create the Admizz **account**, a **team admin user** (this is the shared "Admizz Team" identity and holds the
      channel's API token) and the **website inbox**: domain `admizzeducation.com`, the pre-chat form (name and
      WhatsApp number required, email optional), the built-in email prompt **off**, working hours as decided.
- [ ] Create the **webhook** in that account pointing at EdgeX (`/api/webhooks/chatwoot`), subscribed to
      `message_created`, and note its secret. Write the inbox's **website token** down.
- [ ] Test: open the inbox, send a message from a test page, confirm it arrives.

## Phase 3: EdgeX on stage

- [ ] Apply migrations **294** (allows the `chatwoot` channel type) and **295** (counselor identity table) to the
      **stage** database. **[OK needed]** Both are additive. 295 is service-role-only on purpose (it holds credentials).
- [ ] Set on the stage server: `INBOX_CHATWOOT_ENABLED=true`, `CHATWOOT_BASE_URL`, `CHATWOOT_PLATFORM_TOKEN`, and
      confirm `INBOX_TOKEN_ENC_KEY` is already set (it also protects the WhatsApp channel tokens). **[OK needed]**
- [ ] Set `NEXT_PUBLIC_APP_URL` on the stage server to the public EdgeX address (Chatwoot's webhook is created with it,
      and it must be public HTTPS). **[OK needed]**
- [ ] Connect the tenant from the **Website chat** card (Settings > Communications, owner/admin only): enter the website
      address and press Connect. This replaces the old setup script. It creates the tenant's Chatwoot account, the shared
      team user, the website inbox, the webhook, and the channel row (credentials encrypted), and shows the code to paste
      on the website. **[OK needed]** (writes to a shared database and to the stage Chatwoot).
- [ ] On the card, set the colour, wording and form fields for Admizz, then copy the code for Phase 4.
- [ ] Check the switch: **Chat off** must make the bubble stop loading on the website (it works by changing the inbox's
      allowed sites to an address nothing matches). Not verified in a browser yet.
- [ ] Note: if Connect fails half-way it leaves unused objects in Chatwoot (harmless). Press Connect again; clean up the
      leftovers in Chatwoot's super admin later.
- [ ] Merge the EdgeX branch into `stage` (never straight to `main`); wait for CI (lint, typecheck, build).
      Check CI passes: the developer's laptop build fails on an old file, unrelated to this work.
- [ ] End-to-end test on the stage site: bubble on a test page, a chat arrives in the stage Inbox, link to a lead,
      a reply shows the counselor's name, "Convert to lead" works, a counselor with no profile name shows "Admizz Team".

## Phase 4: Admizz website on stage (`dev-web.admizzeducation.com`)

- [ ] In `nginx/static.conf`, add the Chatwoot address to the security policy (`$csp`): **script-src**, **connect-src**
      (including the `wss://` address for live updates) and **frame-src**. Without this the browser silently blocks the
      bubble. Check the console for "violates the following Content Security Policy" errors.
- [ ] Add the two deploy secrets used at build time: `NEXT_PUBLIC_CHATWOOT_BASE_URL` and `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN`
      (in the stage workflow first). They are baked into the pages at build time, so a change needs a rebuild.
- [ ] Merge the Admizz branch into `stage`; Sadin approves merges (per that repo's rules).
- [ ] Test on the stage site: the bubble appears; the form works with a Nepal number; the bubble is **hidden** on
      `/affiliate-dashboard` and `/affiliate-admin`; on a phone it sits above the bottom bars; the old Tawk.to chat is gone.

## Phase 5: production

- [ ] Repeat Phase 3 on the **production** database and server. **[OK needed]**
- [ ] Repeat Phase 4 for production (secrets, then merge `stage` into `main`). Sadin approves. **[OK needed]**
- [ ] Smoke test with a real phone: send a chat, reply, convert to a lead.
- [ ] Tell the counselors who watches new chats and what visitors see (names, no photos).

## Phase 6: after launch

- [ ] Watch for failed background jobs (Sidekiq) and webhook errors in EdgeX's logs.
- [ ] Test a backup restore once.
- [ ] Write down how to upgrade Chatwoot (read the release notes for the whole jump before upgrading).
- [ ] Decide the schedule for removing chats older than the agreed period.

## Switching it off if something goes wrong

| Where | How | Effect |
|---|---|---|
| EdgeX | Set `INBOX_CHATWOOT_ENABLED` to anything but `true` | New chats stop arriving in EdgeX (the webhook answers 404) and replies from EdgeX fail with a clear message. Chats stay safe in Chatwoot. |
| Admizz site | Remove the two `NEXT_PUBLIC_CHATWOOT_*` secrets and **rebuild and redeploy** (or run the rollback workflow) | The bubble disappears. It is a build-time setting, so removing it needs a rebuild. |
| Chatwoot | Stop its containers | The bubble cannot start chats; nothing else on the sites or in EdgeX is affected. |

## Known gaps before launch

- Not tested outside the developer's laptop: a public Chatwoot address, HTTPS, the Admizz server's security policy.
- The city pages and the university compare tray use the same bottom-bar mechanism but were not measured directly.
- No settings screen in EdgeX yet: the channel is created by script (Phase 3).
- Chat attachments (photos, documents) from visitors are not handled yet; only text.
- Counselors' photos are not shown (names only), as decided.
- The shared Chatwoot "team" user's name is "Admizz Team". A counselor with no name on their EdgeX profile shows as that.
