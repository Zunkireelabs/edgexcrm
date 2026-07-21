# BRIEF — Anonymize customer PII on stage

**Branch:** fresh from latest `origin/stage`:
`git fetch origin && git switch -c chore/scrub-stage-pii origin/stage`

**Deliverable:** a re-runnable script, `scripts/scrub-stage-pii.sh`. **Write the script and prove it on local. Do NOT run it against stage** — that's a separate, supervised step after review.

## Why

CLAUDE.md claimed stage was a sanitized clone with "end-customer PII scrubbed". It isn't — verified on the stage DB: of Admizz's 16,684 live leads, **16,436 carry a real phone number**, and only 38 are obvious test rows. Names and phones came across from prod intact; only auth passwords were reset. (PR #250 corrects the doc.)

That mattered less when stage was just a place to click buttons. It matters now: the AI assistant is enabled for three stage tenants and **write tools are being turned on** (PR #251), so a third-party LLM provider both reads and writes against ~17k real people's names and phone numbers.

The goal is to make CLAUDE.md's original claim true. **Scrubbing must not reduce testing value** — the reason stage is useful is volume and realistic shape, and both survive anonymization. What dies is the link to real people.

---

## Scope — what to scrub

Customer data only. **Sadin chose names + phones + emails.**

| Table | Columns | Rows |
|---|---|---|
| `leads` | `first_name`, `last_name`, `email`, `phone`, `normalized_email`, `normalized_phone`, `company_email` | ~17,770 |
| `lead_submissions` | `first_name`, `last_name`, `email`, `phone`, `normalized_email`, `normalized_phone` | ~1,506 |
| `contacts` | `first_name`, `last_name`, `email`, `phone` | 21 |
| `conversations` | `contact_phone` | 10 |
| `emails` | `from_email`, `to_emails`, `cc_emails`, `bcc_emails` | 20 |
| `_mig158_phone_backup` | `old_phone` | — |

⚠️ **`_mig158_phone_backup` is a leftover backup table holding old phone numbers.** A scrub that misses it isn't a scrub. Either anonymize it or drop it — propose which, don't decide silently.

## Do NOT scrub

- **`auth.users` emails** — CLAUDE.md documents logging into stage as prod emails with `edgexdev123`. Scrubbing these locks everyone out of stage.
- **Staff/user emails**: `tenant_users`, `lead_notes.user_email`, `application_notes.user_email`, `employee_profiles`, `invite_tokens`, `connected_email_accounts`, `tenant_email_settings`. These are Zunkiree/client *staff*, not end customers, and several are load-bearing for login or email routing.
- Anything outside the scope table above. If you think something's missing, **say so and stop** rather than widening scope unilaterally.

---

## Requirements

**1. Stage only, guarded hard.** The script must refuse to run against prod. Take an explicit env argument like `migrate-apply.sh` does, and additionally **abort if the target DB looks like prod** — belt and braces, because this is irreversible. A `--dry-run` that reports what *would* change, without writing, is required.

**2. Preserve testing value.** Row counts unchanged. Do not touch `id`, `display_id`, `tenant_id`, dates, `list_id`/`stage_id`/`pipeline_id`, `assigned_to`, `status`, `tags`, or `custom_fields`. Generated values must keep realistic **shape and distribution**:
- Names: plausible for the tenant's region — Admizz's data is Nepali, so Nepali-style names keep search and relevance testing meaningful. Don't replace everything with `User 1234`.
- Phones: valid-looking `+977-98XXXXXXXX` format so validation and normalization paths behave as before.
- Emails: only where one already exists. **A row with a NULL email must keep NULL** — the null distribution (3,153 of 16,684 have emails) is itself test-relevant.

**3. `normalized_email` / `normalized_phone` must stay consistent with their source columns.** They're derived and the dedup logic reads them (`src/lib/leads/dedup.ts`). Regenerate them with the same normalization the app uses rather than inventing values — inconsistency here silently breaks dedup testing.

**4. Deterministic and re-runnable.** Derive fake values from the row's `id` (e.g. a hash) so the same row always maps to the same fake person. Stage gets re-cloned from prod periodically, so this will be run again — a second run over already-scrubbed data must be safe and produce the same result.

**5. No unique-constraint hazards.** Verified: `leads` has unique indexes only on `id`, `(tenant_id, idempotency_key)` and `display_id` — none on email/phone, so generated duplicates are fine. Don't touch those three.

## Known remaining exposure — document, don't fix

`lead_activities.email_subject` / `email_body` (~2,936 rows) are free text that can contain customer PII, and are exactly the sort of content the AI ingests and cites. Sadin scoped this round to names/phones/emails, so **leave them**, but note them in the script header as known-remaining so the next person doesn't assume "scrubbed" means total.

## Testing — on local, not stage

The local DB has seeded education + real-estate tenants. Prove the script there:

1. `--dry-run` reports the correct row counts and writes nothing.
2. A real run: row counts unchanged, names/phones/emails replaced, NULL emails still NULL.
3. `normalized_email`/`normalized_phone` match what the app's normalization would produce for the new values.
4. **Re-run it**: same output, no errors, no drift (this is the idempotency requirement).
5. The app still works against scrubbed data — leads list loads, search returns hits, a lead detail page renders.
6. The prod guard actually fires: point it at a prod-looking URL and confirm it refuses.

## Gates

```bash
npm run lint          # 0 errors
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
```
(No app code changes expected. If you find yourself editing `src/`, say so and stop.)

## Rules

- **Write the script; do not run it against stage.** Applying it is a supervised step after review.
- No migration — this is data mutation via script, not schema.
- Stop at review: no commit, no push, no PR.
- If any part of this is wrong on inspection, **say so and stop**.
