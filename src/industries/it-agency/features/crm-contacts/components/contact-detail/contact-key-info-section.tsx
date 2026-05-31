"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContactStatusBadge } from "../contact-status-badge";
import type { ContactStatus } from "@/types/database";

interface ContactKeyInfoSectionProps {
  status: ContactStatus;
  title: string | null;
  accountId: string | null;
  accountName: string | null;
  accountOwnerEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium text-foreground mt-0.5">{value}</div>
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

export function ContactKeyInfoSection({
  status,
  title,
  accountId,
  accountName,
  accountOwnerEmail,
  createdAt,
  updatedAt,
}: ContactKeyInfoSectionProps) {
  const [isOpen, setIsOpen] = useState(true);

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
            label="Status"
            value={<ContactStatusBadge status={status} />}
          />
          {title && (
            <InfoRow label="Title" value={title} />
          )}
          {accountId && accountName && (
            <InfoRow
              label="Account"
              value={
                <Link
                  href={`/accounts/${accountId}`}
                  className="hover:underline text-primary"
                >
                  {accountName}
                </Link>
              }
            />
          )}
          {accountOwnerEmail && (
            <InfoRow label="Account Owner" value={accountOwnerEmail} />
          )}
          <InfoRow label="Created" value={formatDate(createdAt)} />
          <InfoRow label="Last Updated" value={formatDate(updatedAt)} />
        </div>
      )}
    </div>
  );
}
