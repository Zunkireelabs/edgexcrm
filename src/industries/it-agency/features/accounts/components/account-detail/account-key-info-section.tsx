"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/types/database";

interface AccountContact {
  id: string;
  first_name: string;
  last_name: string;
}

interface AccountKeyInfoSectionProps {
  ownerEmail: string | null;
  primaryContact: AccountContact | null;
  projectStatusMix: Record<ProjectStatus, number>;
  contactsCount: number;
  openLeadsCount: number;
  createdAt: string;
  updatedAt: string;
  onJumpToTab: (tab: string) => void;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium mt-0.5" style={{ color: "#0f0f10" }}>{value}</div>
    </div>
  );
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function AccountKeyInfoSection({
  ownerEmail,
  primaryContact,
  projectStatusMix,
  contactsCount,
  openLeadsCount,
  createdAt,
  updatedAt,
  onJumpToTab,
}: AccountKeyInfoSectionProps) {
  const [isOpen, setIsOpen] = useState(true);

  const activeProjectsCount =
    (projectStatusMix.planning ?? 0) +
    (projectStatusMix.active ?? 0) +
    (projectStatusMix.in_review ?? 0);

  const primaryContactName = primaryContact
    ? `${primaryContact.first_name} ${primaryContact.last_name}`.trim()
    : null;

  return (
    <div className="border border-border rounded-lg bg-card shadow-none">
      <button
        type="button"
        className="flex items-center justify-between w-full p-3 text-left"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Key Information
        </h3>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div className="px-3 pb-3 pt-0 space-y-3">
          <InfoRow
            label="Owner"
            value={ownerEmail ?? <span className="text-muted-foreground">—</span>}
          />
          <InfoRow
            label="Primary Contact"
            value={
              primaryContact ? (
                <Link
                  href={`/contacts/${primaryContact.id}`}
                  className="hover:underline text-primary"
                >
                  {primaryContactName}
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
          <InfoRow
            label="Active Projects"
            value={
              <button
                type="button"
                className="hover:underline text-primary text-sm font-medium"
                onClick={() => onJumpToTab("projects")}
              >
                {activeProjectsCount}
              </button>
            }
          />
          <InfoRow
            label="Contacts"
            value={
              <button
                type="button"
                className="hover:underline text-primary text-sm font-medium"
                onClick={() => onJumpToTab("contacts")}
              >
                {contactsCount}
              </button>
            }
          />
          <InfoRow
            label="Open Leads"
            value={openLeadsCount}
          />
          <InfoRow label="Created" value={formatDate(createdAt)} />
          <InfoRow label="Last Updated" value={formatDate(updatedAt)} />
        </div>
      )}
    </div>
  );
}
