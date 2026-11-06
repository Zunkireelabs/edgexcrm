"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { LeadList } from "@/types/database";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { NavExpandable } from "@/components/dashboard/nav-primitives";
import { shellIcon } from "@/components/dashboard/shell-icons";

interface LeadListsNavGroupProps {
  lists: Pick<LeadList, "id" | "name" | "slug" | "sort_order">[];
  onNavigate: () => void;
  isAdmin?: boolean;
  collapsed?: boolean;
  /** Display label for the parent row (education: "All leads"; others keep "All Leads"). */
  label?: string;
}

export function LeadListsNavGroup({ lists, onNavigate, isAdmin = false, collapsed = false, label = "All Leads" }: LeadListsNavGroupProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { openSettings } = useSettingsModal();
  const currentList = searchParams.get("list");

  const isOnLeads = pathname === "/leads";
  const hasActiveChild = isOnLeads && currentList != null;
  const parentActive = isOnLeads && currentList == null;

  return (
    <NavExpandable
      icon={shellIcon("Users")}
      label={label}
      href="/leads"
      collapsed={collapsed}
      onNavigate={onNavigate}
      parentActive={parentActive}
      hasActiveChild={hasActiveChild}
      links={lists.map((l) => ({
        key: l.id,
        href: `/leads?list=${l.slug}`,
        label: l.name,
        active: isOnLeads && currentList === l.slug,
      }))}
      action={isAdmin ? { label: "Manage stages", onClick: () => openSettings("lead-management") } : undefined}
    />
  );
}
