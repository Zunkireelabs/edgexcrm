"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, Users, Settings2 } from "lucide-react";
import type { LeadList } from "@/types/database";
import { useSettingsModal } from "@/contexts/settings-modal-context";

interface LeadListsNavGroupProps {
  lists: Pick<LeadList, "id" | "name" | "slug" | "sort_order">[];
  onNavigate: () => void;
  isAdmin?: boolean;
}

export function LeadListsNavGroup({ lists, onNavigate, isAdmin = false }: LeadListsNavGroupProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { openSettings } = useSettingsModal();
  const currentList = searchParams.get("list");

  const isOnLeads = pathname === "/leads";
  const hasActiveChild = isOnLeads && currentList != null;
  const parentActive = isOnLeads && currentList == null;
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasActiveChild) setExpanded(true);
  }, [hasActiveChild]);

  return (
    <div>
      <div className="flex items-center">
        <Link
          href="/leads"
          onClick={onNavigate}
          className={`flex-1 flex items-center gap-3 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            parentActive || hasActiveChild
              ? "bg-[#ebebeb] text-gray-900"
              : "text-gray-500 hover:bg-[#ebebeb] hover:text-gray-900"
          }`}
        >
          <Users className="w-[18px] h-[18px] shrink-0" />
          All Leads
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
                className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-[#ebebeb] text-gray-900 font-medium"
                    : "text-gray-500 hover:bg-[#ebebeb] hover:text-gray-900"
                }`}
              >
                {list.name}
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
              Manage lists
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
