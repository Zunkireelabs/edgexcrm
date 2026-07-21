export { inngest } from "@/lib/inngest/client";

export interface KbItemIngestRequestedEvent {
  name: "kb/item.ingest.requested";
  data: { tenantId: string; itemId: string };
}
