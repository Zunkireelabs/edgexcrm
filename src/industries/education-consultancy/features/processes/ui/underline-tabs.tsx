"use client";

import { useRef } from "react";

export interface UnderlineTab {
  value: string;
  label: string;
  count?: number;
}

/** Underline-style tabs (the mockup's tab row). role=tablist; Left/Right/Home/End move the selection. */
export function UnderlineTabs({ tabs, value, onChange, label }: { tabs: UnderlineTab[]; value: string; onChange: (v: string) => void; label: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (to: number) => {
    const i = (to + tabs.length) % tabs.length;
    onChange(tabs[i].value);
    refs.current[i]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-ds-border">
      {tabs.map((t, i) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`tab-${t.value}`}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") move(i + 1);
              else if (e.key === "ArrowLeft") move(i - 1);
              else if (e.key === "Home") move(0);
              else if (e.key === "End") move(tabs.length - 1);
              else return;
              e.preventDefault();
            }}
            className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13.5px] font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ds-accent ${
              on ? "border-ds-ink text-ds-ink" : "border-transparent text-ds-muted hover:text-ds-ink"
            }`}
          >
            {t.label}
            {t.count !== undefined ? <span className="ml-1.5 text-ds-faint">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
