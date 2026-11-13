"use client";

// Name prompt for "Save as view" — shared by the unsaved-changes bar and More ▸ Create new view.
// Phase 1 views are PERSONAL (saved-lead-filters is private per user, migration 279); shared
// views are the DECIDE ticket EDGEX-119.

import { useState } from "react";
import { MAX_SAVED_FILTER_NAME_LENGTH } from "@/industries/education-consultancy/features/saved-lead-filters/lib/saved-filter-schema";
import { CTRL_PRIMARY } from "@/components/filters/toolbar/tokens";

export interface SaveViewFormProps {
  /** Set when there is nothing to save yet (no filters): shown instead of enabling Save. */
  blockedReason?: string;
  /** Resolves to an error message, or null when saved. */
  onSave: (name: string) => Promise<string | null>;
  onSaved: () => void;
}

export function SaveViewForm({ blockedReason, onSave, onSaved }: SaveViewFormProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || blockedReason || name.trim() === "") return;
    setBusy(true);
    setError(null);
    const err = await onSave(name);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setName("");
    onSaved();
  }

  return (
    <form
      className="flex w-[260px] flex-col gap-2 p-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="leads-save-view-name" className="text-xs font-medium text-ds-faint">
        Name this view (only you can see it)
      </label>
      <input
        id="leads-save-view-name"
        autoFocus
        value={name}
        maxLength={MAX_SAVED_FILTER_NAME_LENGTH}
        disabled={!!blockedReason}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Amit — Prospects"
        className="h-8 rounded-ds-xs bg-ds-surface px-2 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] outline-none placeholder:font-normal placeholder:text-ds-faint focus:shadow-[inset_0_0_0_1px_var(--ds-ghost)] disabled:opacity-60"
      />
      {(blockedReason || error) && <p className="text-xs font-normal text-ds-muted">{blockedReason ?? error}</p>}
      <button type="submit" className={`${CTRL_PRIMARY} justify-center`} disabled={busy || !!blockedReason || name.trim() === ""}>
        {busy ? "Saving…" : "Save view"}
      </button>
    </form>
  );
}
