"use client";

import { usePathname } from "next/navigation";
import type { LeadList } from "@/types/database";
import { NavExpandable } from "@/components/dashboard/nav-primitives";
import { shellIcon } from "@/components/dashboard/shell-icons";

interface LeadsOrganiseNavGroupProps {
  lists: Pick<LeadList, "id" | "name" | "slug">[];
  onNavigate: () => void;
  collapsed?: boolean;
  /** Display label (education: "Organise"; others keep "Leads Organise"). */
  label?: string;
}

export function LeadsOrganiseNavGroup({ lists, onNavigate, collapsed = false, label = "Leads Organise" }: LeadsOrganiseNavGroupProps) {
  const pathname = usePathname();

  const isOnOrganise = pathname === "/leads-organise" || pathname.startsWith("/leads-organise/");
  const hasActiveChild = lists.some((l) => pathname === `/leads-organise/${l.slug}`);
  const parentActive = isOnOrganise && !hasActiveChild;

  return (
    <NavExpandable
      icon={shellIcon("Layers")}
      label={label}
      href="/leads-organise"
      collapsed={collapsed}
      onNavigate={onNavigate}
      parentActive={parentActive}
      hasActiveChild={hasActiveChild}
      links={lists.map((l) => ({
        key: l.id,
        href: `/leads-organise/${l.slug}`,
        label: l.name,
        active: pathname === `/leads-organise/${l.slug}`,
      }))}
    />
  );
}
