# Phase 2 PATCH Brief — ETL fixes (email normalization + dedup)

**Branch:** `feature/application-uploads`
**Phase:** 2-patch (re-run the Phase 2 ETL with 3 fixes) · **STAGE ONLY**
**Owner:** Sonnet executes · Opus reviews
**Context:** Phase 2 loaded correctly (88 apps, 47/37/4, 51 in Applications list) but Opus's stage verification found 2 defects. Fix the ETL script and re-run. Same safety rules as the Phase 2 brief (stage only, resolve by slug/email, backups already exist, re-runnable, no PII in git).

---

## Fixes to apply to the ETL

### Fix 1 — Email normalization (strip ALL whitespace)
Currently emails are only end-trimmed, so the xlsx typo `"bikashsah921 @gmail.com"` (internal space) didn't match and a **3rd duplicate lead** was created (`1618cc52-...`) for someone who already had 2 leads under `bikashsah921@gmail.com`.
- In the email match step, normalize **both sides** as `lower(replace(email,' ',''))` (remove all spaces, not just ends).
- After the re-run, **soft-delete the spurious import-created lead** `1618cc52-2981-4009-8a8e-d997637178f0` (its app will now attach to a pre-existing lead). Verify it ends with `deleted_at` set and no live app.
- Bikash's row should resolve (ambiguously) to the 2 pre-existing leads → apply the standard tie-break (most `lead_activities`, else earliest `created_at`). Log the chosen lead_id.
- (Only this 1 row has the internal-space bug — confirmed across all 88.)

### Fix 2 — Dedup treats blank/Unknown university+program as one empty token
Rohit Gupta got **2 identical Withdrawn apps on the same lead** because the dedup key saw blank universities as distinct.
- In the dedup key `(lead_id, university, program)`, normalize university & program: map `NULL`, `''`, and `'Unknown'` (case-insensitive) all to a single empty token before comparing.
- Effect: Rohit Gupta's 2 → 1.

### Fix 3 — Drop empty Withdrawn duplicates when the lead has a running app (APPROVED)
For a lead that has a **live non-withdrawn** app (Active/Visa), do **not** also create an empty `Unknown`-university Withdrawn app from its Inactive-tab row.
- Rule: if an Inactive row has blank university **and** blank program, **and** the same resolved lead already has an Active/Visa app in this load → **skip** that Inactive row.
- Effect: removes the 2 noise apps (Binayak KC, Vivek Chaurasiya).

### Fix 4 — Placeholder convention
For the genuinely-withdrawn rows with no university (the remaining ~9), set `university_name = 'Not specified'` (not `'Unknown'`) to match the prior migration convention. (`university_name` is `NOT NULL`, so a placeholder is required.)

---

## Expected end-state after re-run (verify)
- **Board apps live ≈ 85**: `need_to_start = 47`, `visa_applied = 4`, `withdrawn = 34` (37 − Rohit dup − 2 noise).
- **Leads created = 0** (Bikash now matches existing).
- Spurious lead `1618cc52` soft-deleted, no live app.
- Rohit Gupta = exactly **1** app.
- No lead that has an Active/Visa app also has an `Unknown`/`Not specified` Withdrawn app.
- Assignee distribution unchanged shape (37/27/3/1 + NULL).
- Applications lead list still = **51** (47 Application Ready + 4 Visa Date Booked) — unchanged.
- Re-run **twice** → identical final counts (idempotent).

## Report back
- Counts table (before/after), stage distribution, the Bikash resolution (chosen lead_id + that `1618cc52` is soft-deleted), Rohit = 1 app, and the updated exception log.
- **STOP.** Stage only. Await Opus review before Phase 3.
