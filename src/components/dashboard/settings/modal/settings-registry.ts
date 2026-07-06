import type { lazy, ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  Bot,
  Users,
  Shield,
  ListChecks,
  GraduationCap,
  MessageSquare,
  Plug,
  FileCheck,
  CalendarClock,
} from "lucide-react";

export interface GatingContext {
  role: string;
  industryId: string | null;
  isEducation: boolean;
}

export interface SettingsCategory {
  key: string;
  label: string;
  icon: LucideIcon;
  isVisible: (ctx: GatingContext) => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  panel: ReturnType<typeof lazy<ComponentType<any>>>;
}

// Panels are lazily imported for code-splitting.
// React.lazy is declared here but the actual dynamic() call happens inside
// settings-modal.tsx where "use client" is in scope.
export const SETTINGS_CATEGORIES: Omit<SettingsCategory, "panel">[] = [
  {
    key: "general",
    label: "General",
    icon: Building2,
    isVisible: () => true,
  },
  {
    key: "ai-orca",
    label: "AI & Orca",
    icon: Bot,
    isVisible: () => true,
  },
  {
    key: "organization",
    label: "Organization",
    icon: Building2,
    isVisible: () => true,
  },
  {
    key: "team-roles",
    label: "Team & Roles",
    icon: Shield,
    isVisible: () => true,
  },
  {
    key: "lead-management",
    label: "Lead Management",
    icon: ListChecks,
    isVisible: () => true,
  },
  {
    key: "leave",
    label: "Leave",
    icon: CalendarClock,
    isVisible: () => true,
  },
  {
    key: "academic-operations",
    label: "Academic Operations",
    icon: GraduationCap,
    isVisible: (_ctx: GatingContext) => _ctx.isEducation,
  },
  {
    key: "communications",
    label: "Communications",
    icon: MessageSquare,
    isVisible: () => true,
  },
  {
    key: "integrations",
    label: "Integrations",
    icon: Plug,
    isVisible: () => true,
  },
  {
    key: "compliance",
    label: "Compliance",
    icon: FileCheck,
    isVisible: (ctx: GatingContext) => ctx.isEducation,
  },
];

// Icon map for external references
export { Building2, Users };
