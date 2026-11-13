/** Shared shapes for the education Home "Do next" list. Pure data: no DB, no React. */

export type DoNextTier = "now" | "today" | "week";
export type Tone = "neutral" | "new" | "bad" | "warn" | "good";

export type DoNextKind =
  | "new_uncalled"
  | "reply_waiting"
  | "callback_overdue"
  | "callback_today"
  | "deadline_docs"
  | "task_due"
  | "going_quiet"
  | "stuck_in_stage"
  | "missed_callbacks"
  | "unreachable";

/** The segmented filter above the list. */
export type DoNextFilter = "all" | "calls" | "messages" | "documents" | "tasks";

export const KIND_FILTER: Record<DoNextKind, Exclude<DoNextFilter, "all">> = {
  new_uncalled: "calls",
  callback_overdue: "calls",
  callback_today: "calls",
  going_quiet: "calls",
  missed_callbacks: "calls",
  unreachable: "calls",
  reply_waiting: "messages",
  deadline_docs: "documents",
  task_due: "tasks",
  stuck_in_stage: "tasks",
};

export type PrimaryAction =
  | { type: "call"; leadId: string; phone: string | null; leadName: string }
  | { type: "reply"; href: string }
  | { type: "ask_docs"; href: string }
  | { type: "done_task"; taskId: string }
  | { type: "open"; href: string; label: string }
  /** Opens a Home sheet listing `children` as normal call rows (the missed call-backs). */
  | { type: "sheet"; label: string };

export interface DoNextItem {
  /** Stable key (kind + subject id): what a snooze is stored against. */
  key: string;
  kind: DoNextKind;
  tier: DoNextTier;
  leadId?: string;
  title: string;
  /** The grey line under the title. */
  why: string;
  chip: { text: string; tone: Tone };
  /** Icon tone for the left tile. */
  tone: Tone;
  primaryAction: PrimaryAction;
  /** Order inside a tier: lower group first, then `at` ascending (ms; oldest / soonest first), then title. */
  sortKey: { group: number; at: number };
  /** Opens the exact records behind the row. */
  evidenceHref: string;
  /** Show "Mark done" in the … menu (tasks only). */
  canMarkDone?: boolean;
  /** reply_waiting only: the conversation's channel, for the row icon. */
  provider?: string;
  /** missed_callbacks only: the exact leads behind the grouped row, as normal call rows. */
  children?: DoNextItem[];
}

export interface ContactEvent {
  type: "call" | "email" | "meeting" | "note";
  /** call_outcome for calls. */
  outcome: string | null;
  at: string;
}

/** A lead assigned to the person, with the few columns the rules need. */
export interface HomeLead {
  id: string;
  name: string;
  phone: string | null;
  assignedAt: string | null;
  createdAt: string;
  /** leads.last_touched_at: call / email / meeting / note (NOT last_activity_at, which only form submissions bump). */
  lastTouchedAt: string | null;
  callbackDueAt: string | null;
  onHold: boolean;
  /** Not archived, not deleted, not in an archive / staging list. */
  isActive: boolean;
  stageName: string | null;
  /** "Australia · Bachelor of Nursing" style context for the grey line. */
  context: string;
  /** Latest logged call outcome, when known (for the call-back line). */
  lastCallOutcome: string | null;
  /**
   * The lead's most recent contacts, newest first (call / email / meeting activities and human notes: see lib/contact.ts).
   * Only loaded for leads with a call-back booked, which is every lead whose last contact was a no-answer / busy call.
   */
  recentContacts?: ContactEvent[];
}

export interface HomeConversation {
  id: string;
  leadId: string | null;
  contactName: string;
  lastMessageAt: string;
  lastDirection: "inbound" | "outbound" | null;
  preview: string | null;
  status: "open" | "closed" | "snoozed";
  snoozedUntil: string | null;
  provider: string;
}

export interface HomeTask {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done";
  dueDate: string | null; // YYYY-MM-DD
  leadId: string | null;
  leadName: string | null;
  assignedByName: string | null;
  createdAt: string;
}

export interface SubmitStage {
  position: number;
  terminalType: "won" | "lost" | null;
  pipelineId: string | null;
}

export interface HomeApplication {
  id: string;
  leadId: string;
  /** applications.assigned_to (who owns it). */
  assigneeId: string | null;
  leadName: string;
  university: string;
  program: string;
  deadline: string | null; // YYYY-MM-DD
  appliedDate: string | null;
  depositPaid: boolean;
  stageName: string;
  stage: SubmitStage;
  stageChangedAt: string;
  /** From the shared computeMissingDocuments(): assessable=false means the tenant has no required list. */
  docs: { assessable: boolean; missingLabels: string[]; requiredCount: number };
}
