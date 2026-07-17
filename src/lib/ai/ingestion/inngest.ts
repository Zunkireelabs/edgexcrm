// Inngest client seam (docs/ai-native-efforts/working/BRIEF-PHASE-2B-INGESTION.md).
//
// Local dev runs unsigned against the Inngest dev server (`npx inngest-cli@latest
// dev`, auto-discovers http://localhost:3000/api/inngest, dashboard on :8288) —
// no INNGEST_SIGNING_KEY needed until prod. Prod keys are a promotion item.

import { Inngest } from "inngest";

export interface KbItemIngestRequestedEvent {
  name: "kb/item.ingest.requested";
  data: { tenantId: string; itemId: string };
}

export const inngest = new Inngest({ id: "edgex-ai" });
