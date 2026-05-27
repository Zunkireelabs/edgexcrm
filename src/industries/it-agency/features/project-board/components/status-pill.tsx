import type { ProjectStatus } from "@/types/database";

const STATUS_CONFIG: Record<ProjectStatus, { label: string; className: string }> = {
  planning:  { label: "Discovery",    className: "bg-slate-100 text-slate-600" },
  active:    { label: "In Progress",  className: "bg-blue-100 text-blue-700" },
  in_review: { label: "Review",       className: "bg-purple-100 text-purple-700" },
  delivered: { label: "Delivered",    className: "bg-green-100 text-green-700" },
  on_hold:   { label: "On Hold",      className: "bg-amber-100 text-amber-700" },
  cancelled: { label: "Cancelled",    className: "bg-red-100 text-red-600" },
};

interface StatusPillProps {
  status: ProjectStatus;
}

export function StatusPill({ status }: StatusPillProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.active;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}
