"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { LeadList } from "@/types/database";
import { NavExpandable } from "@/components/dashboard/nav-primitives";
import { ArchiveIcon } from "@/components/dashboard/shell-icons";

interface ArchiveNavLinksProps {
  /** Archive-type lists (Archived, Delete, …). Rendered as one expandable "Archive" row in the sidebar footer. */
  lists: Pick<LeadList, "id" | "name" | "slug">[];
  onNavigate: () => void;
  collapsed?: boolean;
}

/** The `delete` list is the recycle bin; show it under that name (EDGEX-86 §4). */
export function archiveLinkLabel(list: Pick<LeadList, "name" | "slug">): string {
  return list.slug === "delete" ? "Recycle bin" : list.name;
}

export function ArchiveNavLinks({ lists, onNavigate, collapsed = false }: ArchiveNavLinksProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentList = searchParams.get("list");

  const links = lists.map((list) => ({
    key: list.id,
    href: `/leads?list=${list.slug}`,
    label: archiveLinkLabel(list),
    active: pathname === "/leads" && currentList === list.slug,
  }));

  return (
    <NavExpandable
      icon={ArchiveIcon}
      label="Archive"
      collapsed={collapsed}
      onNavigate={onNavigate}
      hasActiveChild={links.some((l) => l.active)}
      links={links}
    />
  );
}
