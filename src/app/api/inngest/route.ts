import { serve } from "inngest/next";
import { inngest } from "@/lib/ai/ingestion/inngest";
import { kbIngest } from "@/lib/ai/ingestion/kb-ingest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [kbIngest],
});
