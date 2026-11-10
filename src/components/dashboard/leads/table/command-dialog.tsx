"use client";

// ONE reusable command-palette dialog (EDGEX-127, approved mockup "leads-table-v2-bulk"): frosted 4px shell around a white
// card, title + close, big search, grouped rows, keyboard hints + Cancel + a primary button that names the action.
// Move stage, Assign and Add tag are thin configs of this (see leads-table.tsx). No grey page overlay; click outside closes.
//
// Keyboard (chosen): Up/Down move the highlight. single mode: Enter chooses the highlighted row and submits.
// multi mode (tags): Enter toggles the highlighted row, Cmd/Ctrl+Enter submits (Space stays a normal character in the
// search box). Esc closes and Radix returns focus to the bulk-bar button that opened it.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { CheckIcon, PlusIcon, XIcon } from "@/components/icons";

export interface CommandItem {
  id: string;
  label: string;
  /** Muted text after the label ("Counsellor · Kathmandu", "current stage"). */
  sub?: string;
  /** Left adornment (colour dot, avatar). */
  lead?: ReactNode;
  /** Right-aligned muted text (lead count). */
  right?: string;
  group?: string;
  disabled?: boolean;
}

export interface CommandCreate {
  /** Normalise typed text; "" = not creatable. */
  normalise: (raw: string) => string;
  label: (text: string) => string;
}

const SHELL =
  "fixed left-1/2 top-[110px] z-[100] flex w-[720px] max-w-[calc(100vw-24px)] -translate-x-1/2 flex-col rounded-[16px] bg-[rgba(255,255,255,.6)] p-1 backdrop-blur-[16px] shadow-[0_8px_28px_-6px_rgba(28,40,64,.12),0_18px_88px_-4px_rgba(28,40,64,.16),0_0_1px_rgba(28,40,64,.16)] outline-none";
const CARD = "flex flex-col overflow-hidden rounded-[12px] bg-ds-surface shadow-[0_0_0_1px_rgba(28,40,64,.08),0_1px_2px_rgba(28,40,64,.04)]";
const RAISED = "shadow-[0_0_2px_rgba(28,40,64,.18),0_1px_3px_rgba(0,0,0,.04)]";

function EmptyIllustration() {
  return (
    <svg width="92" height="92" viewBox="0 0 92 92" fill="none" stroke="var(--ds-ghost)" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
      <path d="M22 44l24-10 24 10v26L46 80 22 70z" />
      <path d="M22 44l24 10 24-10M46 54v26" />
      <path d="M22 44l-8 9 24 10 8-9M70 44l8 9-24 10-8-9" />
      <circle cx="50" cy="22" r="11" />
      <circle cx="50" cy="22" r="7" />
      <path d="M44 31l-5 14" />
    </svg>
  );
}

export function CommandDialog({
  open,
  onClose,
  title,
  placeholder,
  items,
  mode,
  primaryLabel,
  onSubmit,
  busy = false,
  create,
  emptyLabel = (q: string) => `No results found for “${q}”`,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  placeholder: string;
  items: CommandItem[];
  mode: "single" | "multi";
  /** Names the primary button for the current choice (chosen items, in pick order). */
  primaryLabel: (chosen: CommandItem[]) => string;
  /** Resolves true when the dialog should close (success). `chosen` are item ids; for created tags the normalised text. */
  onSubmit: (chosen: string[]) => Promise<boolean> | boolean;
  busy?: boolean;
  create?: CommandCreate;
  emptyLabel?: (q: string) => string;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [created, setCreated] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Fresh state every time it opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setChosen([]);
      setCreated([]);
      setActive(0);
    }
  }, [open]);

  const all = useMemo<CommandItem[]>(() => [...items, ...created.filter((c) => !items.some((i) => i.id === c)).map((c) => ({ id: c, label: c }))], [items, created]);
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => all.filter((i) => !needle || i.label.toLowerCase().includes(needle) || (i.sub ?? "").toLowerCase().includes(needle)),
    [all, needle],
  );
  const createText = create ? create.normalise(query) : "";
  const exact = createText && all.some((i) => i.id === createText || i.label.toLowerCase() === createText);
  const showCreate = !!create && !!createText && !exact;
  // Rows the keyboard can land on: matches, then the create row.
  const rows: Array<CommandItem | "create"> = useMemo(() => [...matches, ...(showCreate && matches.length > 0 ? (["create"] as const) : [])], [matches, showCreate]);
  const noResults = matches.length === 0;

  useEffect(() => setActive(0), [needle]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const chosenItems = chosen.map((id) => all.find((i) => i.id === id)).filter((i): i is CommandItem => !!i);

  const choose = (item: CommandItem) => {
    if (item.disabled) return;
    setChosen((c) => (mode === "single" ? [item.id] : c.includes(item.id) ? c.filter((x) => x !== item.id) : [...c, item.id]));
  };
  const doCreate = () => {
    if (!showCreate) return;
    setCreated((c) => [...c, createText]);
    setChosen((c) => [...c, createText]);
    setQuery("");
  };
  const submit = async (ids: string[]) => {
    if (ids.length === 0 || busy) return;
    if (await onSubmit(ids)) onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "multi" && (e.metaKey || e.ctrlKey)) return void submit(chosen);
      const row = rows[active];
      if (noResults && showCreate) return doCreate();
      if (!row) return;
      if (row === "create") return doCreate();
      if (mode === "single") {
        if (!row.disabled) void submit([row.id]);
      } else choose(row);
    }
  };

  const primary = primaryLabel(chosenItems);
  const disabled = chosen.length === 0 || busy;

  let lastGroup: string | undefined;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        {/* Transparent overlay: click outside closes, but the page is not greyed. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[99]" />
        <DialogPrimitive.Content className={SHELL} aria-describedby={undefined} onKeyDown={onKeyDown} data-testid="command-dialog">
          <div className={CARD}>
            <div className="flex h-12 items-center border-b border-ds-divider px-4">
              <DialogPrimitive.Title className="text-sm font-medium text-ds-ink">{title}</DialogPrimitive.Title>
              <button type="button" onClick={onClose} aria-label="Close" className="ml-auto grid size-6 place-items-center rounded-ds-xs text-ds-faint hover:text-ds-ink">
                <XIcon className="size-4" />
              </button>
            </div>
            <div className="flex h-14 items-center border-b border-ds-divider px-[18px]">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                aria-label={placeholder}
                className="w-full bg-transparent text-base font-medium text-ds-ink outline-none placeholder:text-ds-faint"
              />
            </div>
            <div ref={listRef} className="max-h-[300px] overflow-y-auto p-2" role="listbox" aria-multiselectable={mode === "multi"}>
              {noResults ? (
                <div className="flex flex-col items-center gap-2.5 pb-8 pt-7 text-sm text-ds-muted">
                  <EmptyIllustration />
                  <div>{needle ? emptyLabel(query.trim()) : "Nothing to choose from"}</div>
                  {showCreate && (
                    <button type="button" onClick={doCreate} className={`inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-ds-surface px-3 text-sm font-medium text-ds-ink ${RAISED}`}>
                      <PlusIcon className="size-4" aria-hidden />
                      {create!.label(createText)}
                    </button>
                  )}
                </div>
              ) : (
                rows.map((row, idx) => {
                  if (row === "create") {
                    return (
                      <button
                        key="__create"
                        type="button"
                        data-row={idx}
                        onMouseMove={() => setActive(idx)}
                        onClick={doCreate}
                        className={`flex h-9 w-full items-center gap-2.5 rounded-[12px] px-2 text-left text-sm text-ds-ink ${active === idx ? "bg-ds-hover" : ""}`}
                      >
                        <span className="grid size-6 place-items-center rounded-[7px] text-ds-muted shadow-[inset_0_0_0_1px_var(--ds-border)]">
                          <PlusIcon className="size-3.5" aria-hidden />
                        </span>
                        {create!.label(createText)}
                      </button>
                    );
                  }
                  const header = row.group && row.group !== lastGroup ? row.group : null;
                  lastGroup = row.group;
                  const on = chosen.includes(row.id);
                  return (
                    <div key={row.id}>
                      {header && <div className="px-2 pb-1 pt-1.5 text-xs text-ds-faint">{header}</div>}
                      <button
                        type="button"
                        role="option"
                        aria-selected={on}
                        aria-disabled={row.disabled}
                        data-row={idx}
                        onMouseMove={() => setActive(idx)}
                        onClick={() => choose(row)}
                        className={`flex h-9 w-full items-center gap-2.5 rounded-[12px] px-2 text-left text-sm text-ds-ink ${active === idx ? "bg-ds-hover" : ""} ${row.disabled ? "opacity-50" : ""}`}
                      >
                        {mode === "multi" && (
                          <span
                            aria-hidden
                            className={`grid size-4 shrink-0 place-items-center rounded-[5px] ${on ? "bg-ds-accent text-white" : "bg-ds-surface shadow-[inset_0_0_0_1.5px_var(--ds-ghost)]"}`}
                          >
                            {on && <CheckIcon className="size-3" />}
                          </span>
                        )}
                        {row.lead}
                        <span className="min-w-0 truncate">{row.label}</span>
                        {row.sub && <span className="shrink-0 text-[13px] text-ds-faint">{row.sub}</span>}
                        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-ds-faint">
                          {row.right}
                          {mode === "single" && on && <CheckIcon className="size-4 text-ds-accent" aria-hidden />}
                        </span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex h-[52px] items-center gap-1.5 border-t border-ds-divider pl-4 pr-3 text-[13px] text-ds-muted">
              <span className="grid size-5 place-items-center rounded-[6px] text-[11px] shadow-[inset_0_0_0_1px_var(--ds-border)]">↑</span>
              <span className="grid size-5 place-items-center rounded-[6px] text-[11px] shadow-[inset_0_0_0_1px_var(--ds-border)]">↓</span>
              Navigate
              <span className="flex-1" />
              <button type="button" onClick={onClose} className="h-8 rounded-ds-sm px-2.5 text-sm font-medium text-ds-muted hover:bg-ds-hover">
                Cancel
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void submit(chosen)}
                className="inline-flex h-8 items-center gap-2 rounded-[9px] bg-ds-accent pl-3 pr-1.5 text-sm font-medium text-white disabled:opacity-45"
              >
                {busy ? "Working…" : primary}
                <span className="grid size-5 place-items-center rounded-[5px] bg-white/20 text-[11px]">{mode === "multi" ? "⌘↵" : "↵"}</span>
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
