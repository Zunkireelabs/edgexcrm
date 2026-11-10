"use client";

// Bulk "Add tag" picker (EDGEX-127, approved mockup state "Add tag picker"): search with tag icon, "Add to N leads"
// label, existing tags as checkbox rows, `+ Create tag "x"` when the typed text matches none, Cancel + `Add N tag(s)`.
// Pure UI: the caller owns the request. Tag text is normalised with the same helper the API re-applies.

import { useMemo, useState } from "react";
import { CheckIcon, PlusIcon, TagIcon } from "@/components/icons";
import { MAX_ADD_TAGS, MAX_TAG_LEN, normaliseLeadTag } from "@/lib/leads/tags";
import { CTRL, CTRL_PRIMARY, ITEM, POP_LABEL, POP_SEP } from "../toolbar/tokens";

// Presentational box (the row itself is the checkbox button; a real <Checkbox> would nest a button in a button).
function Box({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-4 shrink-0 place-items-center rounded-[5px] ${on ? "bg-ds-accent text-white" : "bg-ds-surface shadow-[inset_0_0_0_1.5px_var(--ds-ghost)]"}`}
    >
      {on && <CheckIcon className="size-3" />}
    </span>
  );
}

export function AddTagPicker({
  leadCount,
  existingTags,
  busy,
  onCancel,
  onSubmit,
}: {
  leadCount: number;
  existingTags: string[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (tags: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [created, setCreated] = useState<string[]>([]);

  const pool = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...existingTags, ...created]) {
      const n = normaliseLeadTag(t);
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [existingTags, created]);

  const needle = normaliseLeadTag(query);
  const shown = needle ? pool.filter((t) => t.includes(needle)) : pool;
  const canCreate = needle.length > 0 && needle.length <= MAX_TAG_LEN && !pool.includes(needle);
  const atLimit = picked.length >= MAX_ADD_TAGS;

  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : p.length >= MAX_ADD_TAGS ? p : [...p, t]));

  return (
    <div data-testid="add-tag-picker" className="w-[300px]">
      <label className="-mx-1 -mt-1 mb-1 flex h-9 items-center gap-2 rounded-t-[10px] border-b border-ds-divider px-2.5 text-ds-faint">
        <TagIcon className="size-4 shrink-0" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search or create a tag…"
          aria-label="Search or create a tag"
          className="min-w-0 flex-1 bg-transparent text-sm font-normal text-ds-ink outline-none placeholder:text-ds-faint"
        />
      </label>
      <div className={POP_LABEL}>Add to {leadCount.toLocaleString()} {leadCount === 1 ? "lead" : "leads"}</div>
      <div className="max-h-[220px] overflow-y-auto">
        {shown.length === 0 && !canCreate && <div className="px-2 py-2 text-sm font-normal text-ds-faint">No tags yet. Type to create one.</div>}
        {shown.map((t) => (
          <button
            key={t}
            type="button"
            role="checkbox"
            aria-checked={picked.includes(t)}
            className={ITEM}
            onClick={() => toggle(t)}
            disabled={!picked.includes(t) && atLimit}
          >
            <Box on={picked.includes(t)} />
            <span className="min-w-0 flex-1 truncate">{t}</span>
          </button>
        ))}
      </div>
      {canCreate && (
        <>
          <div className={POP_SEP} />
          <button
            type="button"
            className={ITEM}
            onClick={() => {
              setCreated((c) => [...c, needle]);
              setPicked((p) => (p.length >= MAX_ADD_TAGS ? p : [...p, needle]));
              setQuery("");
            }}
          >
            <PlusIcon className="size-4 text-ds-muted" aria-hidden />
            Create tag “{needle}”
          </button>
        </>
      )}
      <div className={POP_SEP} />
      <div className="flex items-center justify-end gap-1.5 p-1">
        <button type="button" className={CTRL} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={CTRL_PRIMARY} disabled={picked.length === 0 || busy} onClick={() => onSubmit(picked)}>
          {busy ? "Adding…" : `Add ${picked.length || ""} ${picked.length === 1 ? "tag" : "tags"}`.replace("  ", " ")}
        </button>
      </div>
    </div>
  );
}
