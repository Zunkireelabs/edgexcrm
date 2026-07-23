import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { kbIngest } from "@/lib/ai/ingestion/kb-ingest";
import { heartbeat } from "@/lib/inngest/functions/heartbeat";
import { remindersScan } from "@/lib/inngest/functions/reminders";
import { inboxProcess } from "@/lib/inngest/functions/inbox-process";
import { emailPoll } from "@/lib/inngest/functions/email-poll";
import { agentLeadTriage } from "@/lib/inngest/functions/agent-lead-triage";
import { agentFollowUpDrafter } from "@/lib/inngest/functions/agent-follow-up-drafter";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [kbIngest, heartbeat, remindersScan, inboxProcess, emailPoll, agentLeadTriage, agentFollowUpDrafter],
});
