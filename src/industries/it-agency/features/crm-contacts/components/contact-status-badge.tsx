"use client";

import { Badge } from "@/components/ui/badge";
import type { ContactStatus } from "@/types/database";

const STATUS_MAP: Record<ContactStatus, { label: string; className: string }> = {
  active:   { label: "Active",   className: "bg-green-50 text-green-700 border-green-200" },
  inactive: { label: "Inactive", className: "bg-gray-100 text-gray-500 border-gray-200" },
};

interface ContactStatusBadgeProps {
  status: ContactStatus;
}

export function ContactStatusBadge({ status }: ContactStatusBadgeProps) {
  const { label, className } = STATUS_MAP[status] ?? STATUS_MAP.active;
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}
