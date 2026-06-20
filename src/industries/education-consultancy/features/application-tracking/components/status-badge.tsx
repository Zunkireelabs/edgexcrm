"use client";

interface StatusBadgeProps {
  slug: string;
  name: string;
  color?: string;
  terminalType?: "won" | "lost" | null;
}

export function StatusBadge({ name, color, terminalType }: StatusBadgeProps) {
  let className = "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full";
  if (terminalType === "won") {
    className += " bg-green-100 text-green-700";
  } else if (terminalType === "lost") {
    className += " bg-red-100 text-red-700";
  } else {
    className += " bg-muted text-foreground";
  }

  return (
    <span className={className}>
      {color && !terminalType && (
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      )}
      {name}
    </span>
  );
}
