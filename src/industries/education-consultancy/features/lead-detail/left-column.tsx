"use client";

import { DotsThreeIcon } from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getLeadFullName } from "@/components/dashboard/lead/lead-name";
import type { Lead, LeadList, PipelineStage } from "@/types/database";
import type { Assignee, Person, useLeadActions } from "./use-lead-actions";

type Actions = ReturnType<typeof useLeadActions>;

export interface LeftColumnProps {
  lead: Lead;
  actions: Actions;
  stages: PipelineStage[];
  leadLists: LeadList[];
  activeLeadLists: LeadList[];
  userId: string;
  memberNames: Record<string, string>;
  isAdmin: boolean;
  leadScope: "all" | "own" | "team" | undefined;
  canEdit: boolean;
  isEditor: boolean;
  canAssign: boolean;
  canMoveWithoutChain: boolean;
  revertTargetUserId: string | null;
  consentEnabled: boolean;
  consentSigned: boolean;
  assignableMembers: Person[];
  stageScopedAssignees: Assignee[] | null;
  roster: Person[];
  onNote: () => void;
  onTask: () => void;
  onEditProfile: (missing?: string[]) => void;
  onDelete: () => void;
  mainRef: React.MutableRefObject<{ enabled: boolean; run: () => void } | null>;
}

/** EDGEX-151 placeholder: the frame's left column shows the student's name (the page h1) until EDGEX-152 fills it. */
export function LeftColumn({ actions }: LeftColumnProps) {
  return (
    <div className="px-4 pb-3 pt-4">
      <h1 className="m-0 truncate text-[18px] font-semibold leading-6 tracking-[-.01em]">{getLeadFullName(actions.currentLead, "Unnamed lead")}</h1>
    </div>
  );
}

export function MoreMenu({ isAdmin, onCopyLink, onCopyId, onDelete, bordered }: { isAdmin: boolean; onCopyLink: () => void; onCopyId: () => void; onDelete: () => void; bordered?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="More actions" title="More actions" className={`inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] text-[#6b6f76] outline-none hover:bg-[#f6f7f9] hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 data-[state=open]:bg-[#f6f7f9] ${bordered ? "bg-white text-[#2b2d2f] shadow-[inset_0_0_0_1px_#e8e9eb]" : ""}`}>
        <DotsThreeIcon className="size-[14px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px] rounded-[12px]">
        <DropdownMenuItem className="rounded-[8px]" onSelect={onCopyLink}>Copy link to this lead</DropdownMenuItem>
        <DropdownMenuItem className="rounded-[8px]" onSelect={onCopyId}>Copy lead ID</DropdownMenuItem>
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="rounded-[8px] text-[#c4321f] focus:text-[#c4321f]" onSelect={onDelete}>Delete lead</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
