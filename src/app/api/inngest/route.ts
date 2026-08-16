import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { kbIngest } from "@/lib/ai/ingestion/kb-ingest";
import { heartbeat } from "@/lib/inngest/functions/heartbeat";
import { remindersScan } from "@/lib/inngest/functions/reminders";
import { inboxProcess } from "@/lib/inngest/functions/inbox-process";
import { emailPoll } from "@/lib/inngest/functions/email-poll";
import { emailInboundProcess } from "@/lib/inngest/functions/email-inbound-process";
import { displayIdBackfillSweep } from "@/lib/inngest/functions/display-id-backfill-sweep";
import { classCompletionSweep } from "@/lib/inngest/functions/class-completion-sweep";
import { agentLeadTriage } from "@/lib/inngest/functions/agent-lead-triage";
import { agentFollowUpDrafter } from "@/lib/inngest/functions/agent-follow-up-drafter";
import { agentDailyDigest } from "@/lib/inngest/functions/agent-daily-digest";
import { agentMcpWriteGate } from "@/lib/inngest/functions/agent-mcp-write-gate";
import { smsBlastSend } from "@/lib/inngest/functions/sms-blast-send";
import { smsDeliveryPoll, smsBlastPollReceipts } from "@/lib/inngest/functions/sms-delivery-poll";
import { smsCreditReaper } from "@/lib/inngest/functions/sms-credit-reaper";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    kbIngest,
    heartbeat,
    remindersScan,
    inboxProcess,
    emailPoll,
    emailInboundProcess,
    displayIdBackfillSweep,
    classCompletionSweep,
    agentLeadTriage,
    agentFollowUpDrafter,
    agentDailyDigest,
    agentMcpWriteGate,
    smsBlastSend,
    smsDeliveryPoll,
    smsBlastPollReceipts,
    smsCreditReaper,
  ],
});
