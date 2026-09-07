# Engineering lessons

Hard-won rules pulled off `STATUS-BOARD.md` on 2026-09-07. They were sitting in a queue of items 'needing a decision', which is the wrong home — they are things to read *before* writing the code that would otherwise reproduce the bug.

Original board text preserved. Four entries appeared **twice** on the board (PostgREST embed FKs, PATCH invariants, route shells, `.select()` shape); those duplicate pairs are merged into a single entry each here.

---

- **An unpaged "collect the ids, then filter by them" query silently truncates at PostgREST's 1000-row cap**: the two-step pattern — query A collects candidate ids, query B filters `.in(...)` on them — is the right way to avoid `UND_ERR_HEADERS_OVERFLOW` from a huge `.in()` list, but query A itself needs a bound. Without `.limit()`/paging it stops at PostgREST's default 1000 rows, so the id set is short, and query B then **silently omits rows** with no error anywhere. Worse than the overflow it replaces: overflow throws, this just returns a wrong-but-plausible list. Live instance: `GET /api/v1/inbox/conversations` (PR #394) collects candidate `lead_id`s unpaged — correct today (10 conversations tenant-wide) and reachable once WhatsApp goes live against 16k+ Admizz leads. Same root cause as the tracked *"aggregate-tools 1000-row PostgREST paging sweep"* item in SESSION-LOG — fold this in when that sweep runs. Rule: any query whose **result set feeds a subsequent filter** must be paged or provably bounded; "the set is small today" is a note to write down, not a design.

- **Reusing an access helper: check whether it gates on edit rights before using it as a view check**: `requireLeadAccess()` (`src/lib/api/auth.ts:251`) returns false on `!canEditLeads`, and `canEditLeads` is false for viewers (`permissions.ts:76` — *"counselors edit own; viewers don't"*). Using it to answer "can this user *see* X" would deny a `leadScope:"all"` viewer access they currently have. Caught in PR #394 review before it shipped. More generally: when list and detail must agree, they must resolve visibility through the **same** function — `visibleLeadsBase` bakes in `lead_collaborators` + `lead_branches` visibility that a hand-rolled per-row check does not reproduce, and any divergence reopens the "list shows it, detail 404s" bug class.

- **Cross-cutting predicate audits must grep the whole repo**: when a feature introduces a new "soft state" filter (e.g. `WHERE converted_at IS NULL`, `WHERE deleted_at IS NULL`), DON'T trust a hand-curated targets list — grep `from("TableName")` across `src/` and audit EVERY hit. Phase D's filter audit punted on `/api/v1/pipelines` and `/api/v1/pipelines/[id]` because the planning prompt didn't enumerate them; the kanban (via queries.ts) was filtered but the pipeline selector dropdowns (via API) weren't, producing inconsistent UI counts. Fix landed as `11a3460`. Same class of bug as forgetting to filter `deleted_at` in a query.

- **Radix Select forbids empty-string `<SelectItem value="">`**: Radix UI reserves `value=""` for "clear selection / show placeholder" and throws at render time. Use a sentinel string (e.g. `"__none__"`) and map it to null/undefined at submit. Same constraint applies to shadcn's Select (built on Radix). Not caught by TypeScript or lint — runtime-only error. Applies to any future picker UI.

- **Page-padding stacks with the dashboard shell**: when restyling a page, check the outer page wrapper's padding against `src/components/dashboard/shell.tsx:409` — the shell already wraps page content in `p-4 mr-4 mb-4`. Pages that add their own `p-4` / `p-6` / `p-8` on the outermost wrapper **stack** that padding on top of the shell's, producing an inset that's 2× what was intended. Reference page that intentionally relies on the shell only: `/pipeline` (`src/app/(main)/(dashboard)/pipeline/page.tsx:80`). Pages that historically added their own padding and now mismatch the shell (fixed): `/projects` (`workspace.tsx`, fixed in `2aa45df`). Same rule applies to top-margin and side-padding. Hit on 2026-05-28 PM: `/projects` was double-padding to 40px-from-edge vs Pipeline's 16px — invisible in code, glaring in screenshots side-by-side.

- **PostgREST embed FK disambiguation**: any time a migration adds a reverse FK between two tables that already have a forward FK, every `.select("*, OtherTable(...)")` between those tables MUST use the explicit FK name (e.g. `accounts!contacts_account_id_fkey(id, name)`). Latent bug hidden until the first embed query runs. Grep for `select.*${otherTable}\\(` whenever adding a reverse FK.

  *(This appeared twice on the status board; the duplicate has been merged here.)*

- **PATCH preserves POST invariants**: any field-level invariant enforced on POST (e.g. "at least one of email or phone required") MUST also be enforced on PATCH. Fetch the existing row, compute the resulting state with the patch applied, validate.

  *(This appeared twice on the status board; the duplicate has been merged here.)*

- **New page components need a route shell**: when scaffolding a new UI component (e.g. ContactDetailPage), the corresponding Next.js page shell at `src/app/.../[id]/page.tsx` MUST be created in the same phase, even if the component is just a placeholder. "Exported but not wired yet" is not a valid phase-A state.

  *(This appeared twice on the status board; the duplicate has been merged here.)*

- **`.select()` after insert/update**: the return shape must match what the UI consumes for optimistic adds. If the read endpoint joins on `accounts(id, name)`, the insert endpoint must too — else freshly-created rows show with empty join columns until refresh.

  *(This appeared twice on the status board; the duplicate has been merged here.)*
