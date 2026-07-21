import { Inngest } from "inngest";

// Canonical Inngest client for ALL EdgeX background work (ops jobs + AI/KB
// ingestion). One app id = one Inngest app = one dashboard; every function
// imports from here so they register under the same app.
//
// Local: set INNGEST_DEV=1 in .env.local and run `npx inngest-cli dev` (unsigned
// dev server, auto-discovers http://localhost:3000/api/inngest, dashboard :8288).
// Stage/prod: INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY are set (never INNGEST_DEV),
// so the SDK connects to Inngest Cloud. Keys are runtime secrets (server-only) —
// they live in the VPS .env.local, never NEXT_PUBLIC, never build args.
export const inngest = new Inngest({ id: "edgex-ai" });
