"use client";

// "Where / and / or" — the root tree.conjunction switch between stacked root
// conditions. Hand-rolled 2-state toggle rather than a toggle-group primitive
// (there isn't one installed, and two states don't warrant adding one).

export interface ConjunctionToggleProps {
  value: "and" | "or";
  onChange: (next: "and" | "or") => void;
  disabled?: boolean;
}

export function ConjunctionToggle({ value, onChange, disabled }: ConjunctionToggleProps) {
  return (
    <div className="inline-flex h-7 shrink-0 items-center rounded-md border border-input bg-background p-0.5 text-xs font-medium">
      {(["and", "or"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt)}
          className={`rounded-sm px-2 py-0.5 capitalize transition-colors disabled:pointer-events-none disabled:opacity-50 ${
            value === opt ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
