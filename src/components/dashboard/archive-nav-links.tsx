"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Archive, Trash2 } from "lucide-react";
import type { LeadList } from "@/types/database";

interface ArchiveNavLinksProps {
  /** Archive-type lists (Archived, Delete, …) rendered as top-level LEADS nav items. */
  lists: Pick<LeadList, "id" | "name" | "slug">[];
  onNavigate: () => void;
}

export function ArchiveNavLinks({ lists, onNavigate }: ArchiveNavLinksProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentList = searchParams.get("list");

  return (
    <>
      {lists.map((list) => {
        const active = pathname === "/leads" && currentList === list.slug;
        const Icon = list.slug === "delete" ? Trash2 : Archive;
        return (
          <Link
            key={list.id}
            href={`/leads?list=${list.slug}`}
            onClick={onNavigate}
            className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] leading-5 font-medium transition-colors ${
              active
                ? "bg-[#ebebeb] text-gray-900"
                : "text-[#0f172a] hover:bg-[#ebebeb] hover:text-gray-900"
            }`}
          >
            <Icon className="w-[18px] h-[18px] shrink-0" />
            {list.name}
          </Link>
        );
      })}
    </>
  );
}
