"use client";

import { useState, useRef, useEffect } from "react";
import { Check, Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const MAX_TAG_LEN = 50;

function normaliseTag(raw: string): string {
  return raw.trim().slice(0, MAX_TAG_LEN);
}

interface TagMultiPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  allTags: string[];
  placeholder?: string;
  size?: "sm" | "md";
}

export function TagMultiPicker({
  value,
  onChange,
  allTags,
  placeholder = "Add tags…",
  size = "md",
}: TagMultiPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Auto-focus search when popover opens
  useEffect(() => {
    if (open) {
      // Radix Portal needs a tick before the DOM node is accessible
      const id = setTimeout(() => searchRef.current?.focus(), 0);
      return () => clearTimeout(id);
    } else {
      // Why: react-hooks/set-state-in-effect (React 19) rejects synchronous setState
      // inside an effect body; deferring via setTimeout places the update outside
      // the synchronous effect execution.
      const id = setTimeout(() => setQuery(""), 0);
      return () => clearTimeout(id);
    }
  }, [open]);

  const lowerQuery = query.toLowerCase();

  const filteredPool = allTags.filter((t) =>
    t.toLowerCase().includes(lowerQuery)
  );

  const trimmedQuery = normaliseTag(query);
  const queryExistsInPool = allTags.some(
    (t) => t.toLowerCase() === lowerQuery
  );
  const queryAlreadySelected = value.some(
    (t) => t.toLowerCase() === lowerQuery
  );
  const showCreate =
    trimmedQuery.length > 0 && !queryExistsInPool && !queryAlreadySelected;

  function toggle(tag: string) {
    if (value.includes(tag)) {
      onChange(value.filter((t) => t !== tag));
    } else {
      onChange([...value, tag]);
    }
  }

  function selectExisting(tag: string) {
    // Case-insensitive match: if pool has the tag in its stored casing, prefer that
    const existing = allTags.find((t) => t.toLowerCase() === tag.toLowerCase());
    const canonical = existing ?? tag;
    if (!value.includes(canonical)) {
      onChange([...value, canonical]);
    }
    setQuery("");
  }

  function createTag() {
    if (!trimmedQuery) return;
    // Case-insensitive duplicate guard against current value
    if (value.some((t) => t.toLowerCase() === trimmedQuery.toLowerCase())) {
      // Treat as "select existing" — just clear the query
      setQuery("");
      return;
    }
    onChange([...value, trimmedQuery]);
    setQuery("");
  }

  const chipCls =
    size === "sm"
      ? "inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 text-gray-700 text-[11px] rounded-full"
      : "inline-flex items-center gap-0.5 px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full border border-gray-200";

  const triggerCls =
    size === "sm"
      ? "inline-flex items-center gap-1 flex-wrap min-h-[24px] text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
      : "inline-flex items-center gap-1 flex-wrap min-h-[28px] px-2 py-1 border border-dashed border-gray-300 rounded-md bg-white text-xs text-muted-foreground hover:border-gray-400 cursor-pointer";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerCls}>
          {value.length > 0 ? (
            value.map((tag) => (
              <span key={tag} className={chipCls}>
                {tag}
                <span
                  role="button"
                  aria-label={`Remove tag ${tag}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(value.filter((t) => t !== tag));
                  }}
                  className="hover:text-red-500 transition-colors cursor-pointer"
                >
                  <X className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
                </span>
              </span>
            ))
          ) : (
            <span className="flex items-center gap-0.5">
              <Plus className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
              {placeholder}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-56 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Search input */}
        <div className="px-2 pt-2 pb-1 border-b border-gray-100">
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (showCreate) {
                  createTag();
                } else if (filteredPool.length > 0) {
                  selectExisting(filteredPool[0]);
                }
              }
            }}
            placeholder="Search or create…"
            className="w-full text-xs outline-none bg-transparent placeholder:text-muted-foreground/60"
          />
        </div>

        {/* Tag list */}
        <div className="max-h-48 overflow-y-auto py-1">
          {filteredPool.length === 0 && !showCreate && (
            <p className="text-[11px] text-muted-foreground px-3 py-2">
              {allTags.length === 0
                ? "No tags yet — type to create one."
                : "No tags match."}
            </p>
          )}

          {filteredPool.map((tag) => {
            const selected = value.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggle(tag)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-left"
              >
                <span
                  className={[
                    "inline-flex items-center justify-center w-3.5 h-3.5 rounded border shrink-0",
                    selected
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-gray-300 bg-white",
                  ].join(" ")}
                >
                  {selected && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className="truncate text-gray-700">{tag}</span>
              </button>
            );
          })}

          {/* Create option */}
          {showCreate && (
            <button
              type="button"
              onClick={createTag}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-left text-blue-600"
            >
              <Plus className="h-3 w-3 shrink-0" />
              Create &ldquo;{trimmedQuery}&rdquo;
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
