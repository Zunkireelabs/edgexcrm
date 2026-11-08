"use client";

// "Unsaved changes · Discard · Save as view" (mockup `.dirty`). Appears only when the filters or
// sort differ from the active view's baseline; nothing persists until Save. Phase 1 saves a
// PERSONAL view (the saved-lead-filters store is private per user, migration 279), so the button
// says "Save as view", not Attio's "Save for everyone" (shared views: DECIDE EDGEX-119).

import { useState } from "react";
import { CaretDownIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MAX_SAVED_FILTER_NAME_LENGTH } from "@/industries/education-consultancy/features/saved-lead-filters/lib/saved-filter-schema";
import { CTRL, CTRL_PRIMARY, POP } from "./tokens";

export interface UnsavedBarProps {
  /** False when there is nothing a saved view could store (no filters; sort alone isn't saved). */
  canSave: boolean;
  onDiscard: () => void;
  /** Resolves to an error message, or null when saved. */
  onSave: (name: string) => Promise<string | null>;
}

export function UnsavedBar({ canSave, onDiscard, onSave }: UnsavedBarProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || name.trim() === "") return;
    setBusy(true);
    setError(null);
    const err = await onSave(name);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setName("");
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-1.5" data-testid="leads-unsaved-bar">
      <span className="mr-1 text-[13px] font-medium text-ds-muted">Unsaved changes</span>
      <button type="button" className={CTRL} onClick={onDiscard}>
        Discard
      </button>
      {canSave && (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) setError(null);
          }}
        >
          <PopoverTrigger asChild>
            <button type="button" className={CTRL_PRIMARY}>
              Save as view
              <CaretDownIcon className="size-3.5 opacity-80" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={4} className={POP}>
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
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Amit — Prospects"
                className="h-8 rounded-ds-xs bg-ds-surface px-2 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] outline-none placeholder:font-normal placeholder:text-ds-faint focus:shadow-[inset_0_0_0_1px_var(--ds-ghost)]"
              />
              {error && <p className="text-xs font-normal text-ds-bad">{error}</p>}
              <button type="submit" className={`${CTRL_PRIMARY} justify-center`} disabled={busy || name.trim() === ""}>
                {busy ? "Saving…" : "Save view"}
              </button>
            </form>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
