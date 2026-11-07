import type { HomeApplication, HomeConversation, HomeLead, HomeTask } from "./types";

export const lead = (o: Partial<HomeLead> = {}): HomeLead => ({
  id: "l1",
  name: "Sujan Rai",
  phone: "+97798",
  assignedAt: "2026-11-09T04:00:00.000Z",
  createdAt: "2026-11-01T00:00:00.000Z",
  lastTouchedAt: null,
  callbackDueAt: null,
  onHold: false,
  isActive: true,
  stageName: "Qualified",
  context: "Australia · Bachelor of Nursing",
  lastCallOutcome: null,
  ...o,
});

export const conv = (o: Partial<HomeConversation> = {}): HomeConversation => ({
  id: "c1",
  leadId: "l1",
  contactName: "Bikram Thapa",
  lastMessageAt: "2026-11-09T04:00:00.000Z",
  lastDirection: "inbound",
  preview: "Is IELTS 6.0 enough?",
  status: "open",
  snoozedUntil: null,
  provider: "whatsapp",
  ...o,
});

export const task = (o: Partial<HomeTask> = {}): HomeTask => ({
  id: "t1",
  title: "Send SOP feedback",
  status: "todo",
  dueDate: "2026-11-09",
  leadId: null,
  leadName: null,
  assignedByName: "Sadin",
  createdAt: "2026-11-06T00:00:00.000Z",
  ...o,
});

export const app = (o: Partial<HomeApplication> = {}): HomeApplication => ({
  id: "a1",
  leadId: "l9",
  leadName: "Sita Gurung",
  university: "Deakin",
  program: "Master of IT",
  deadline: "2026-11-15",
  appliedDate: null,
  depositPaid: false,
  stageName: "Documents Pending",
  stage: { position: 1, terminalType: null, pipelineId: "p1" },
  stageChangedAt: "2026-11-05T00:00:00.000Z",
  docs: { assessable: true, missingLabels: ["Bank statement"], requiredCount: 4 },
  ...o,
});
