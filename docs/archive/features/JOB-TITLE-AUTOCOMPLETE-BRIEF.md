# Job-title autocomplete on the People form — BUILD BRIEF (for Sonnet)

**Type:** Frontend only. **No API, no DB, no migration, no new dependency.** Global HR feature (all tenants).
**Branch:** `git fetch origin && git switch -c feature/job-title-autocomplete origin/stage`
**Guardrails:** branch only — **do NOT merge, do NOT push to prod.** Build + lint, then **STOP for Opus review.**

---

## Why (context)

Follow-up to the Positions→Roles rename. Job title is the HR truth (free-text on `employee_profiles.job_title`), deliberately kept separate from access Roles. To reduce double-entry and keep titles consistent across a tenant, the Job title field on the People edit form should **suggest titles already used in this tenant** — while still allowing any free-text (suggest, don't constrain).

**Key simplifier:** the data is already in memory. `src/components/dashboard/hr/people-directory.tsx` already fetches every employee (`rows: EmployeeRow[]`, each with `profile.job_title`). So suggestions come from existing client state — **no new endpoint, no query, no table.**

---

## Scope — one file: `src/components/dashboard/hr/people-directory.tsx`

The Job title input lives in the edit-sheet child component (around L435–436):
```tsx
<Label>Job title</Label>
<Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} disabled={!canEditAtAll} />
```

### Change
1. In the **parent** `PeopleDirectory`, derive the distinct suggestion list from the already-loaded `rows` (memoized):
   ```tsx
   const jobTitleSuggestions = useMemo(
     () => Array.from(new Set(
       rows.map(r => r.profile?.job_title?.trim()).filter((t): t is string => !!t)
     )).sort((a, b) => a.localeCompare(b)),
     [rows]
   );
   ```
2. Pass `jobTitleSuggestions` as a prop into the edit-sheet component that renders the Job title input.
3. Wire the input to a native **`<datalist>`** (zero new deps, free-text preserved):
   ```tsx
   <Input
     value={jobTitle}
     onChange={(e) => setJobTitle(e.target.value)}
     disabled={!canEditAtAll}
     list="job-title-suggestions"
   />
   <datalist id="job-title-suggestions">
     {jobTitleSuggestions.map((t) => <option key={t} value={t} />)}
   </datalist>
   ```
   (If two edit sheets could ever mount at once, make the `id` unique per instance to avoid a duplicate-id collision — e.g. suffix the employee id. Single-sheet-at-a-time is fine with a static id.)

That's the whole change. Free typing still works; the datalist only offers matches.

### Do NOT
- Add an API/route/query, a new table, a migration, or a combobox dependency (native `<datalist>` is the deliberate low-complexity choice).
- Change the save path (`PATCH` already sends `job_title`), the Roles/Positions surfaces, or anything outside this one file.
- Constrain the field to the suggestions — it must remain free-text.

---

## Verify + report (then STOP)
1. `npm run build` clean; `npx eslint --max-warnings 50` → 0 errors, 0 new warnings in the file.
2. Manual (local `npm run dev`, `admin@zunkireelabs.com` / `admin123`): open **People → edit an employee** → the Job title field now offers existing tenant titles (e.g. "Front End Developer") as you focus/type, and still accepts a brand-new typed title. Saving persists as before.
3. Report the diff + confirm no API/DB/dependency change. **STOP for Opus review.**

---

## Notes for the reviewer (Opus)
- Small squash-merge to `stage` (0 approvals) post-review; rides the next promotion. Code-only, no prod-DB step.
- This closes out the Positions/Job-title cleanup trio: #1 rename (shipped), #2 naming guidance (shipped), #3 this.
