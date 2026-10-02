"use client";

import { createContext, useContext, useEffect, useRef } from "react";

/**
 * One page-level edit mode for the lead profile.
 *
 * The page owns a single `isEditing` flag (the one Edit button). Every editable
 * section reads it through `useEditSession()` and shows its form when it's on. Each
 * section also registers a `getPatch()` with `useEditSection()`; the page's single Save
 * asks every registered section what changed, merges the answers, and sends ONE PATCH.
 * A section returns null when the user didn't touch it, so an untouched section adds
 * nothing to the request.
 */

/** What a section of the lead profile exposes to the page-level Save. */
export interface EditSectionHandle {
  /** Fields this section wants saved, or null when nothing changed. */
  getPatch: () => Record<string, unknown> | null;
}

export interface EditRegistry {
  /** Registers a section; returns the function that unregisters it. */
  register: (id: string, handle: EditSectionHandle) => () => void;
  /** Merges every registered section's patch. Sections that changed nothing add nothing. */
  collectPatch: () => Record<string, unknown>;
}

export function createEditRegistry(): EditRegistry {
  const sections = new Map<string, EditSectionHandle>();
  return {
    register(id, handle) {
      sections.set(id, handle);
      return () => {
        // Only remove our own registration — a newer one under the same id must survive.
        if (sections.get(id) === handle) sections.delete(id);
      };
    },
    collectPatch() {
      const merged: Record<string, unknown> = {};
      for (const handle of sections.values()) {
        const patch = handle.getPatch();
        if (patch) Object.assign(merged, patch);
      }
      return merged;
    },
  };
}

interface EditSessionValue {
  isEditing: boolean;
  register: EditRegistry["register"];
}

const EditSessionContext = createContext<EditSessionValue>({
  isEditing: false,
  register: () => () => {},
});

export const EditSessionProvider = EditSessionContext.Provider;

export function useEditSession(): EditSessionValue {
  return useContext(EditSessionContext);
}

/** Registers a section's `getPatch` with the page-level Save for as long as it's mounted. */
export function useEditSection(id: string, getPatch: () => Record<string, unknown> | null): void {
  const { register } = useEditSession();
  const latest = useRef(getPatch);
  useEffect(() => {
    latest.current = getPatch;
  });
  useEffect(() => register(id, { getPatch: () => latest.current() }), [id, register]);
}
