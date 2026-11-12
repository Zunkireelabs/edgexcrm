"use client";

import { useMemo, useState } from "react";
import { ArrowLeftIcon, MagnifyingGlassIcon } from "@/components/icons";
import type { Lead } from "@/types/database";
import { DetailRow, InlineText } from "./details";
import { PROFILE_FIELDS, profileFieldValue } from "./lib/profile-fields";
import { BigAvatar } from "./ui";
import { initialsOf } from "../record-preview/parts";

/** "View all values": the whole profile as a searchable list (mockup state 4), edited in place like the Details rows. */
export function AllValues({
  lead, name, canEdit, onPatch, onBack,
}: { lead: Lead; name: string; canEdit: boolean; onPatch: (fields: Record<string, unknown>, label?: string) => Promise<boolean>; onBack: () => void }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return PROFILE_FIELDS.filter((f) => !needle || f.label.toLowerCase().includes(needle));
  }, [q]);

  return (
    <div>
      <div className="px-4 pb-1 pt-4">
        <div className="flex items-center gap-2.5">
          <BigAvatar initials={initialsOf(name)} />
          <span className="truncate text-[18px] font-semibold leading-6 tracking-[-.01em]">{name}</span>
        </div>
      </div>
      <div className="mt-1 flex h-10 items-center gap-2 border-y border-[#f0f1f2] px-4 text-black/50">
        <button type="button" aria-label="Back to details" title="Back to details" onClick={onBack} className="inline-flex size-6 items-center justify-center rounded-[6px] outline-none hover:bg-[#f6f7f9] hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50">
          <ArrowLeftIcon className="size-[14px]" />
        </button>
        <MagnifyingGlassIcon className="size-[14px]" aria-hidden />
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields…" aria-label="Search fields"
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onBack(); } }}
          className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-[#101112] outline-none placeholder:text-black/50"
        />
      </div>
      <div className="px-2.5 pt-1.5" role="list" aria-label="All values">
        {rows.length === 0 && <p className="px-1.5 py-6 text-center text-[13px] text-black/50">No fields match “{q.trim()}”</p>}
        {rows.map((f) => {
          const v = profileFieldValue(lead, f.key);
          return (
            <div role="listitem" key={f.key}>
              {editing === f.key ? (
                <DetailRow icon={<f.icon />} label={f.label} active>
                  <InlineText
                    value={v} placeholder={f.label} type={f.type === "date" ? "date" : "text"}
                    onSave={(next) => onPatch(f.key === "city" ? { city: next || null } : { [f.key]: next || null }, f.label.toLowerCase())}
                    onDone={() => setEditing(null)}
                  />
                </DetailRow>
              ) : (
                <DetailRow icon={<f.icon />} label={f.label} editable={canEdit} onActivate={() => setEditing(f.key)} empty={!v}>
                  <span className="truncate">{v || `Set ${f.label.toLowerCase()}`}</span>
                </DetailRow>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
