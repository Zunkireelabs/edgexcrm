"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check } from "lucide-react";
import { MemberAvatar } from "@/components/ui/member-avatar";

interface AssignableMember {
  user_id: string;
  name: string;
  email: string;
}

export function AssigneeChip({ seed, label }: { seed: string | null; label: string }) {
  if (!seed) {
    return <span className="text-gray-400 text-sm">Unassigned</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <MemberAvatar userId={seed} name={label} />
      <span className="truncate text-sm text-[#787871]">{label}</span>
    </span>
  );
}

function memberLabel(member: AssignableMember): string {
  return member.name || member.email?.split("@")[0] || member.user_id;
}

interface AssigneeSelectorProps {
  currentAssigneeId: string | null;
  members: AssignableMember[];
  onChange: (memberId: string | null) => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Inline assignee editor for the leads table — mirrors StageSelector's popover pattern,
 * but with a searchable Command list instead of a flat button list (member rosters can be large).
 */
export function AssigneeSelector({
  currentAssigneeId,
  members,
  onChange,
  disabled = false,
}: AssigneeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = members.find((m) => m.user_id === currentAssigneeId);
  const currentLabel = current ? memberLabel(current) : "";

  if (disabled) {
    return <AssigneeChip seed={currentAssigneeId} label={currentLabel} />;
  }

  async function handlePick(memberId: string | null) {
    if (memberId === currentAssigneeId) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      await onChange(memberId);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={saving}
          className="inline-flex items-center rounded px-1 py-0.5 -mx-1 transition-opacity hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <AssigneeChip seed={currentAssigneeId} label={currentLabel} />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Assign to…" />
          <CommandList>
            <CommandEmpty>No members found.</CommandEmpty>
            <CommandGroup>
              {currentAssigneeId && (
                <CommandItem
                  key="unassign"
                  value="unassign"
                  onSelect={() => handlePick(null)}
                >
                  <Check className="opacity-0" />
                  <span className="text-gray-500">Unassign</span>
                </CommandItem>
              )}
              {members.map((member) => (
                <CommandItem
                  key={member.user_id}
                  value={memberLabel(member) + " " + member.email}
                  onSelect={() => handlePick(member.user_id)}
                >
                  <Check
                    className={member.user_id === currentAssigneeId ? "" : "opacity-0"}
                  />
                  <MemberAvatar userId={member.user_id} name={memberLabel(member)} />
                  <span className="truncate">{memberLabel(member)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
