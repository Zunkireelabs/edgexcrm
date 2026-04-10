// Orca AI Orchestration Types

export type AutomationLevel = 'fully_automated' | 'agent_human' | 'human_led';

export type RoleType = 'human' | 'agent' | 'hybrid';

export type ViewMode = 'people' | 'agents';

export interface RoleTask {
  id: string;
  name: string;
  description?: string;
  automationLevel: AutomationLevel;
  agentHandles?: string;
  humanHandles?: string;
}

export interface TaskRole {
  id: string;
  name: string;
  slug: string;
  tasks: RoleTask[];
}

export interface OrgRole {
  id: string;
  name: string;
  type: RoleType;
  description?: string;
  responsibilities?: string[];
  agentCount?: number; // Number of agents attached (shown as dots)
  children?: OrgRole[];
}

export interface OrgLayer {
  label: string;
  description?: string;
  roles: OrgRole[];
}

export interface Handoff {
  id: string;
  fromRole: string;
  toRole: string;
  trigger: string;
}

export interface OrcaStats {
  tasksAutomated: number;
  totalTasks: number;
  fullyAutomated: number;
  agentHuman: number;
  humansWeekPercent: number;
  humansWeekDescription: string;
  humansRole: string;
  humansRoleDescription: string;
}

// Color mapping for automation levels
export const AUTOMATION_COLORS: Record<AutomationLevel, { bg: string; border: string; text: string }> = {
  fully_automated: {
    bg: 'bg-emerald-50',
    border: 'border-l-emerald-500',
    text: 'text-emerald-700',
  },
  agent_human: {
    bg: 'bg-amber-50',
    border: 'border-l-amber-500',
    text: 'text-amber-700',
  },
  human_led: {
    bg: 'bg-blue-50',
    border: 'border-l-blue-500',
    text: 'text-blue-700',
  },
};

export const AUTOMATION_LABELS: Record<AutomationLevel, string> = {
  fully_automated: 'Fully automated',
  agent_human: 'Agent + human',
  human_led: 'Human-led',
};
