"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronDown, Check } from "lucide-react";
import type { LeadList } from "@/types/database";

const ARCHIVE_REASONS = [
  "Not interested",
  "Wrong number",
  "Not reachable",
  "Already enrolled elsewhere",
  "Other",
];

interface MoveToListSelectorProps {
  leadId: string;
  currentListId: string | null;
  lists: LeadList[];
  onMove: (listId: string, archiveReason?: string) => Promise<void>;
  disabled?: boolean;
}

export function MoveToListSelector({
  currentListId,
  lists,
  onMove,
  disabled = false,
}: MoveToListSelectorProps) {
  const [open, setOpen] = useState(false);
  const [pendingList, setPendingList] = useState<LeadList | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [saving, setSaving] = useState(false);

  const currentList = lists.find((l) => l.id === currentListId);

  function handleListClick(list: LeadList) {
    if (list.id === currentListId) {
      setOpen(false);
      return;
    }
    if (list.is_archive) {
      setPendingList(list);
      setArchiveReason("");
      setCustomReason("");
    } else {
      void confirmMove(list, undefined);
    }
  }

  async function confirmMove(list: LeadList, reason: string | undefined) {
    setSaving(true);
    try {
      await onMove(list.id, reason);
      setOpen(false);
      setPendingList(null);
      setArchiveReason("");
      setCustomReason("");
    } finally {
      setSaving(false);
    }
  }

  function handleArchiveSubmit() {
    if (!pendingList) return;
    const finalReason = archiveReason === "Other" ? customReason.trim() : archiveReason;
    void confirmMove(pendingList, finalReason || undefined);
  }

  const label = currentList?.name ?? "—";

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setPendingList(null); }}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled || saving}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="whitespace-nowrap">{label}</span>
          <ChevronDown className="w-3 h-3 shrink-0" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-52 p-1" align="start">
        {pendingList ? (
          <div className="p-2 space-y-2">
            <p className="text-xs font-medium text-gray-700">
              Drop reason for archiving
            </p>
            <div className="space-y-1">
              {ARCHIVE_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setArchiveReason(r)}
                  className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${
                    archiveReason === r
                      ? "bg-blue-100 text-blue-800 font-medium"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            {archiveReason === "Other" && (
              <textarea
                className="w-full border rounded text-xs p-1 resize-none h-14 focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="Describe reason…"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
              />
            )}
            <div className="flex gap-1 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={handleArchiveSubmit}
                className="flex-1 text-xs bg-blue-600 text-white rounded px-2 py-1 hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Moving…" : "Archive"}
              </button>
              <button
                type="button"
                onClick={() => setPendingList(null)}
                className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[10px] font-medium text-gray-400 px-2 py-1 uppercase tracking-wide">
              Move to
            </p>
            {lists.map((list) => (
              <button
                key={list.id}
                type="button"
                onClick={() => handleListClick(list)}
                className="w-full text-left flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-gray-100 transition-colors"
              >
                <Check
                  className={`w-3 h-3 shrink-0 ${
                    list.id === currentListId ? "text-blue-600" : "opacity-0"
                  }`}
                />
                <span className={list.is_archive ? "text-gray-400" : "text-gray-700"}>
                  {list.name}
                </span>
              </button>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
