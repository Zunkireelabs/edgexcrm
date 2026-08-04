"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, PackageOpen } from "lucide-react";
import type { LeadList } from "@/types/database";

interface LeadsOrganiseNavGroupProps {
  lists: Pick<LeadList, "id" | "name" | "slug">[];
  onNavigate: () => void;
}

export function LeadsOrganiseNavGroup({ lists, onNavigate }: LeadsOrganiseNavGroupProps) {
  const pathname = usePathname();

  const isOnOrganise = pathname === "/leads-organise" || pathname.startsWith("/leads-organise/");
  const hasActiveChild = lists.some((l) => pathname === `/leads-organise/${l.slug}`);
  const parentActive = isOnOrganise && !hasActiveChild;
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasActiveChild) setExpanded(true);
  }, [hasActiveChild]);

  return (
    <div>
      <div className="flex items-center">
        <Link
          href="/leads-organise"
          onClick={onNavigate}
          className={`flex-1 flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium transition-colors ${
            parentActive
              ? "bg-[#ebebeb] text-gray-900"
              : "text-[#666666] hover:bg-[#ebebeb] hover:text-gray-900"
          }`}
        >
          <PackageOpen className="w-[18px] h-[18px] shrink-0" />
          Leads Organise
        </Link>
        {lists.length > 0 && (
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

      {expanded && lists.length > 0 && (
        <div className="relative mt-1 ml-[20px] space-y-0.5">
          {(() => {
            const activeIndex = lists.findIndex((l) => pathname === `/leads-organise/${l.slug}`);
            return lists.map((list, idx) => {
              const active = idx === activeIndex;
              const isLast = idx === lists.length - 1;
              const topDark = activeIndex !== -1 && idx <= activeIndex;
              const bottomDark = activeIndex !== -1 && idx < activeIndex;
              return (
                <div key={list.id} className="relative pl-[18px]">
                  <span aria-hidden className={`absolute left-0 top-0 h-1/2 w-px ${topDark ? "bg-gray-400" : "bg-gray-200"}`} />
                  {!isLast && <span aria-hidden className={`absolute left-0 top-1/2 bottom-0 w-px ${bottomDark ? "bg-gray-400" : "bg-gray-200"}`} />}
                  <span aria-hidden className={`absolute left-0 top-1/2 -translate-y-1/2 w-[10px] h-px ${active ? "bg-gray-400" : "bg-gray-200"}`} />
                  <Link
                    href={`/leads-organise/${list.slug}`}
                    onClick={onNavigate}
                    className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] leading-5 transition-colors ${
                      active
                        ? "bg-[#ebebeb] text-gray-900 font-medium"
                        : "text-[#666666] hover:bg-[#ebebeb] hover:text-gray-900"
                    }`}
                  >
                    {list.name}
                  </Link>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}
