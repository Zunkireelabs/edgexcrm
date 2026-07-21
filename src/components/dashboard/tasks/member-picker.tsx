"use client";

import { useRef, useState } from "react";
import { Check, UserCircle2 } from "lucide-react";
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
import { MemberAvatar } from "@/components/ui/member-avatar";

export interface RosterMember {
  user_id: string;
  name: string;
}

interface MemberPickerProps {
  members: RosterMember[];
  value: string | null;
  onChange: (userId: string | null) => void;
  currentUserId?: string;
  /** Fired the first time the dropdown opens — use to lazy-fetch the roster. */
  onOpen?: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export function MemberPicker({
  members,
  value,
  onChange,
  currentUserId,
  onOpen,
  disabled,
  loading,
}: MemberPickerProps) {
  const [open, setOpen] = useState(false);
  const openedRef = useRef(false);

  const selected = value ? members.find((m) => m.user_id === value) : null;
  const label = value === currentUserId ? "You" : selected?.name ?? "Unassigned";

  function handleOpenChange(next: boolean) {
    if (disabled) return;
    if (next && !openedRef.current) {
      openedRef.current = true;
      onOpen?.();
    }
    setOpen(next);
  }

  function handleSelect(userId: string) {
    onChange(userId);
    setOpen(false);
  }

  const sorted = currentUserId
    ? [...members].sort((a, b) =>
        a.user_id === currentUserId ? -1 : b.user_id === currentUserId ? 1 : 0
      )
    : members;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {selected ? (
            <MemberAvatar userId={selected.user_id} name={selected.name} size={20} />
          ) : (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-100 text-violet-700 shrink-0">
              <UserCircle2 className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="truncate max-w-[8rem]">{label}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Assign to…" />
          <CommandList>
            {loading ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Loading members…</div>
            ) : (
              <>
                <CommandEmpty>No members found</CommandEmpty>
                <CommandGroup>
                  {sorted.map((m) => (
                    <CommandItem
                      key={m.user_id}
                      value={m.name}
                      onSelect={() => handleSelect(m.user_id)}
                    >
                      <Check className={m.user_id === value ? "" : "opacity-0"} />
                      <MemberAvatar userId={m.user_id} name={m.name} size={20} />
                      <span className="truncate text-gray-700">
                        {m.user_id === currentUserId ? "You" : m.name}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
