"use client";

import {
  Building2,
  Edit,
  ToggleLeft,
  UserCheck,
  FolderPlus,
  FolderClock,
  FolderMinus,
  Clock,
  CheckCircle,
  XCircle,
  UserPlus,
  ArrowRightCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { PROJECT_STATUS_MAP } from "@/industries/it-agency/features/time-tracking/components/status-badge";
import type { ProjectStatus } from "@/types/database";

export interface ActivityItem {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

function getEventDisplay(item: ActivityItem): { icon: LucideIcon; text: string } {
  const p = item.payload;
  const changedFields = Array.isArray(p.changed_fields) ? (p.changed_fields as string[]) : [];

  switch (item.type) {
    case "account.created":
      return { icon: Building2, text: "Account created" };

    case "account.updated": {
      if (changedFields.includes("is_active")) {
        const newVal = (p.new as Record<string, unknown>)?.is_active;
        return { icon: ToggleLeft, text: newVal ? "Account marked Active" : "Account marked Inactive" };
      }
      if (changedFields.includes("primary_contact_id")) {
        return { icon: UserCheck, text: "Primary contact changed" };
      }
      const fieldList = changedFields.filter((f) => f !== "updated_at").join(", ");
      return { icon: Edit, text: fieldList ? `Account updated — ${fieldList}` : "Account updated" };
    }

    case "project.created": {
      const name = p.project_name as string | null;
      return { icon: FolderPlus, text: name ? `Project «${name}» created` : "Project created" };
    }

    case "project.updated": {
      const newStatus = (p.new as Record<string, unknown>)?.status as string | undefined;
      const name = p.project_name as string | null;
      if (newStatus) {
        const label = PROJECT_STATUS_MAP[newStatus as ProjectStatus]?.label ?? newStatus;
        return { icon: FolderClock, text: name ? `Project «${name}» → ${label}` : `Project status → ${label}` };
      }
      return { icon: Edit, text: name ? `Project «${name}» updated` : "Project updated" };
    }

    case "project.deleted": {
      const name = p.project_name as string | null;
      return { icon: FolderMinus, text: name ? `Project «${name}» deleted` : "Project deleted" };
    }

    case "time_entry.logged": {
      const email = p.user_email as string | null;
      const name = email ? email.split("@")[0] : "Someone";
      const hrs = (((p.minutes_sum as number) ?? 0) / 60).toFixed(1);
      const proj = p.project_name as string | null;
      return { icon: Clock, text: proj ? `${name} logged ${hrs}h on «${proj}»` : `${name} logged ${hrs}h` };
    }

    case "time_entry.approved": {
      const email = p.user_email as string | null;
      const name = email ? email.split("@")[0] : "Someone";
      const hrs = (((p.minutes as number) ?? 0) / 60).toFixed(1);
      const proj = p.project_name as string | null;
      return { icon: CheckCircle, text: proj ? `${name}'s ${hrs}h on «${proj}» approved` : `Time entry approved` };
    }

    case "time_entry.rejected": {
      const email = p.user_email as string | null;
      const name = email ? email.split("@")[0] : "Someone";
      const hrs = (((p.minutes as number) ?? 0) / 60).toFixed(1);
      const proj = p.project_name as string | null;
      return { icon: XCircle, text: proj ? `${name}'s ${hrs}h on «${proj}» rejected` : `Time entry rejected` };
    }

    case "contact.created": {
      const name = p.contact_name as string | null;
      return { icon: UserPlus, text: name ? `Contact ${name} added` : "Contact added" };
    }

    case "lead.created": {
      const name = p.lead_name as string | null;
      return { icon: UserPlus, text: name ? `Lead ${name} added` : "Lead added" };
    }

    case "lead.converted": {
      const name = p.lead_name as string | null;
      return { icon: ArrowRightCircle, text: name ? `Lead ${name} converted to contact` : "Lead converted to contact" };
    }

    default:
      return { icon: Building2, text: item.type.replace(/\./g, " ") };
  }
}

export function ActivityRow({ item }: { item: ActivityItem }) {
  const { icon: Icon, text } = getEventDisplay(item);

  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-border last:border-b-0">
      <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm" style={{ color: "#0f0f10" }}>{text}</p>
      </div>
      <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
        {formatRelativeTime(item.created_at)}
      </span>
    </div>
  );
}
