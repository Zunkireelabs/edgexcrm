// Inngest client seam (docs/ai-native-efforts/working/BRIEF-PHASE-2B-INGESTION.md).
//
// Local dev runs unsigned against the Inngest dev server (`npx inngest-cli@latest
// dev`, auto-discovers http://localhost:3000/api/inngest, dashboard on :8288) —
// no INNGEST_SIGNING_KEY needed until prod. Prod keys are a promotion item.
//
// Set INNGEST_DEV=1 in .env.local — without it the SDK's own prod-vs-dev
// inference (NODE_ENV, presence of a signing key, etc.) can misfire and it
// tries to talk to Inngest Cloud instead of the local dev server, so
// `kb/item.ingest.requested` events silently never reach `kb-ingest` even
// with the dev server running. This was discovered undocumented during
// Phase 2B verification.

import { Inngest } from "inngest";

export interface KbItemIngestRequestedEvent {
  name: "kb/item.ingest.requested";
  data: { tenantId: string; itemId: string };
}

export const inngest = new Inngest({ id: "edgex-ai" });
