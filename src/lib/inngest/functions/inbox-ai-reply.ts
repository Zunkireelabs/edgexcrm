import { inngest } from "@/lib/inngest/client";
import { AI_REPLY_EVENT } from "@/lib/inbox/ai-reply/config";
import { realAiReplyDeps } from "@/lib/inbox/ai-reply/deps";
import { runAiReply } from "@/lib/inbox/ai-reply/run";

// Answers a website-chat visitor with the Admizz AI while no counsellor has accepted the chat (docs/WEBSITE-CHAT-AI-REPLY-BRIEF.md).
// Triggered by process-inbound after a visitor's message is saved. The 5-second debounce per chat turns a quick burst such as
// "Study in the UK" / "Ok" / "Fast" into ONE answer. Safe to retry: it only answers while the visitor spoke last, so a retry
// after a successful send finds the AI's own message last and does nothing. Failures send nothing: the chat waits for a person.
export const inboxAiReply = inngest.createFunction(
  {
    id: "inbox-ai-reply",
    triggers: [{ event: AI_REPLY_EVENT }],
    debounce: { key: "event.data.conversationId", period: "5s", timeout: "30s" },
    concurrency: { limit: 4, key: "event.data.tenantId" },
    retries: 1,
  },
  async ({ event, step }) => {
    const { tenantId, conversationId } = event.data as { tenantId: string; conversationId: string };
    return await step.run("ai-reply", () => runAiReply({ tenantId, conversationId }, realAiReplyDeps()));
  },
);
