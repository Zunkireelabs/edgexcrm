import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { kbIngest } from "@/lib/ai/ingestion/kb-ingest";
import { heartbeat } from "@/lib/inngest/functions/heartbeat";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [kbIngest, heartbeat],
});
