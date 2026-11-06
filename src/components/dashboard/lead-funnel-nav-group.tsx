"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { LeadList } from "@/types/database";
import { useSettingsModal } from "@/contexts/settings-modal-context";
import { NavExpandable } from "@/components/dashboard/nav-primitives";
import type { Icon } from "@/components/dashboard/shell-icons";

interface LeadFunnelNavGroupProps {
  funnelKey: string;
  label: string;
  icon: Icon;
  lists: Pick<LeadList, "id" | "name" | "slug" | "sort_order">[];
  onNavigate: () => void;
  isAdmin?: boolean;
  collapsed?: boolean;
}

/** Sidebar group for one it_agency funnel (Lead Processing / Sales Leads) — same
 * chrome as `LeadListsNavGroup`, but the group header opens the whole funnel
 * (`?funnel=`). */
export function LeadFunnelNavGroup({ funnelKey, label, icon, lists, onNavigate, isAdmin = false, collapsed = false }: LeadFunnelNavGroupProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { openSettings } = useSettingsModal();
  const currentList = searchParams.get("list");
  const currentFunnel = searchParams.get("funnel");

  const isOnLeads = pathname === "/leads";
  const listSlugs = new Set(lists.map((l) => l.slug));
  const hasActiveChild = isOnLeads && currentList != null && listSlugs.has(currentList);
  const parentActive = isOnLeads && currentList == null && currentFunnel === funnelKey;

  return (
    <NavExpandable
      icon={icon}
      label={label}
      href={`/leads?funnel=${funnelKey}`}
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
