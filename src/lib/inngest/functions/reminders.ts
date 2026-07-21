import { inngest } from "@/lib/inngest/client";
import { runTaskReminders, runOutreachDraftReminders } from "@/lib/inngest/jobs/reminders";

// Durable replacement for the reminders-run GitHub-Actions cron. Each scan is its own step.run,
// so it retries independently and is memoized across retries (a completed scan never re-notifies).
// Parallel-bake: the GH cron still calls the HTTP route with the SAME logic; idempotent stamps make
// a double-fire a no-op (worst case one duplicate in-app notification, never a dropped one).
export const remindersScan = inngest.createFunction(
  { id: "ops-reminders-scan", triggers: [{ cron: "*/15 * * * *" }] },
  async ({ step }) => {
    const tasks = await step.run("task-reminders", () => runTaskReminders());
    const outreach = await step.run("outreach-drafts", () => runOutreachDraftReminders());
    return { tasks, outreach };
  },
);
