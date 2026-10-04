// Limits shared by the bulk draft actions' server code (lib/bulk-drafts.ts) and their screen (ui/bulk-draft-dialog.tsx).
// Kept in a module with no imports so the browser bundle never pulls server-only code in with a number.

/** Most drafts one Send now / Schedule can act on. */
export const BULK_DRAFT_MAX = 5000;
/** Drafts skipped per request: each skip creates the next step's draft (several queries), so a request stays short. */
export const SKIP_BATCH = 50;
/** From this many drafts up, the person must confirm (the screen asks them to type the action). */
export const BULK_DRAFT_CONFIRM_FROM = 50;
