"use client";

// "Unsaved changes · Discard · Save as view" (mockup `.dirty`). Appears only when the filters or
// sort differ from the active view's baseline; nothing persists until Save. Phase 1 saves a
// PERSONAL view (the saved-lead-filters store is private per user, migration 279), so the button
// says "Save as view", not Attio's "Save for everyone" (shared views: DECIDE EDGEX-119).

import { useState } from "react";
import { CaretDownIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SaveViewForm } from "./save-view-form";
import { CTRL, CTRL_PRIMARY, POP } from "@/components/filters/toolbar/tokens";

export interface UnsavedBarProps {
  /** False when there is nothing a saved view could store (no filters; sort alone isn't saved). */
  canSave: boolean;
  onDiscard: () => void;
  /** Resolves to an error message, or null when saved. */
  onSave: (name: string) => Promise<string | null>;
}

export function UnsavedBar({ canSave, onDiscard, onSave }: UnsavedBarProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1.5" data-testid="leads-unsaved-bar">
      <span className="mr-1 text-[13px] font-medium text-ds-muted">Unsaved changes</span>
      <button type="button" className={CTRL} onClick={onDiscard}>
        Discard
      </button>
      {canSave && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={CTRL_PRIMARY}>
              Save as view
              <CaretDownIcon className="size-3.5 opacity-80" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={4} className={POP}>
            <SaveViewForm onSave={onSave} onSaved={() => setOpen(false)} />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
