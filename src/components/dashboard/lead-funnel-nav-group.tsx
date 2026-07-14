"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, Settings2, type LucideIcon } from "lucide-react";
import type { LeadList } from "@/types/database";
import { useSettingsModal } from "@/contexts/settings-modal-context";

interface LeadFunnelNavGroupProps {
  funnelKey: string;
  label: string;
  icon: LucideIcon;
  lists: (Pick<LeadList, "id" | "name" | "slug" | "sort_order"> & { count?: number })[];
  onNavigate: () => void;
  isAdmin?: boolean;
}

/** Sidebar group for one it_agency funnel (Lead Processing / Sales Leads) — same
 * collapsible chrome as `LeadListsNavGroup`, but the group header opens the whole
 * funnel (`?funnel=`) and nested rows show a live lead count per stage. */
export function LeadFunnelNavGroup({ funnelKey, label, icon: Icon, lists, onNavigate, isAdmin = false }: LeadFunnelNavGroupProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { openSettings } = useSettingsModal();
  const currentList = searchParams.get("list");
  const currentFunnel = searchParams.get("funnel");

  const isOnLeads = pathname === "/leads";
  const listSlugs = new Set(lists.map((l) => l.slug));
  const hasActiveChild = isOnLeads && currentList != null && listSlugs.has(currentList);
  const parentActive = isOnLeads && currentList == null && currentFunnel === funnelKey;
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasActiveChild) setExpanded(true);
  }, [hasActiveChild]);

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={`/leads?funnel=${funnelKey}`}
          onClick={onNavigate}
          className={`flex-1 flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium transition-colors ${
            parentActive || hasActiveChild
              ? "bg-[#ebebeb] text-gray-900"
              : "text-[#0f172a] hover:bg-[#ebebeb] hover:text-gray-900"
          }`}
        >
          <Icon className="w-[18px] h-[18px] shrink-0" />
          {label}
        </Link>
        {(lists.length > 0 || isAdmin) && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="px-1.5 py-2 text-gray-400 hover:text-gray-700"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {expanded && (lists.length > 0 || isAdmin) ? (
        <div className="relative mt-1 ml-[20px] pl-[18px] border-l border-gray-300 space-y-1">
          {lists.map((list) => {
            const active = isOnLeads && currentList === list.slug;
            return (
              <Link
                key={list.id}
                href={`/leads?list=${list.slug}`}
                onClick={onNavigate}
                className={`w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] leading-5 transition-colors ${
                  active
                    ? "bg-[#ebebeb] text-gray-900 font-medium"
                    : "text-[#0f172a] hover:bg-[#ebebeb] hover:text-gray-900"
                }`}
              >
                <span className="truncate">{list.name}</span>
                {typeof list.count === "number" && (
                  <span className="shrink-0 text-[11px] text-gray-400 tabular-nums">{list.count}</span>
                )}
              </Link>
            );
          })}
          {isAdmin && (
            <button
              type="button"
              onClick={() => { onNavigate(); openSettings("lead-management"); }}
              className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-[#ebebeb] transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5 shrink-0" />
              Manage stages
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
