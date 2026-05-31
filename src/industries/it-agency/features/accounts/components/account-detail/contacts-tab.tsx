"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactStatusBadge } from "@/industries/it-agency/features/crm-contacts/components/contact-status-badge";
import type { ContactStatus } from "@/types/database";

interface AccountContact {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  title: string | null;
  status: string;
}

interface ContactsTabProps {
  contacts: AccountContact[];
  isAdmin: boolean;
  onCreateContact: () => void;
}

function getInitials(first: string, last: string): string {
  return ((first?.charAt(0) ?? "") + (last?.charAt(0) ?? "")).toUpperCase() || "?";
}

export function ContactsTab({ contacts, isAdmin, onCreateContact }: ContactsTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{contacts.length} contact{contacts.length !== 1 ? "s" : ""}</p>
        {isAdmin && (
          <Button size="sm" onClick={onCreateContact}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add contact
          </Button>
        )}
      </div>

      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No contacts yet.
          {isAdmin && (
            <button
              type="button"
              className="ml-1 text-primary hover:underline"
              onClick={onCreateContact}
            >
              Add the first one.
            </button>
          )}
        </p>
      ) : (
        <div className="space-y-1">
          {contacts.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 p-2.5 border border-border rounded-lg hover:bg-muted/40 transition-colors"
            >
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                <span className="text-xs font-semibold text-muted-foreground">
                  {getInitials(c.first_name, c.last_name)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <Link
                  href={`/contacts/${c.id}`}
                  className="text-sm font-medium hover:underline block truncate"
                  style={{ color: "#0f0f10" }}
                >
                  {`${c.first_name} ${c.last_name}`.trim()}
                </Link>
                {c.title && (
                  <p className="text-xs truncate" style={{ color: "#787871" }}>{c.title}</p>
                )}
              </div>
              {c.email && (
                <a
                  href={`mailto:${c.email}`}
                  className="text-xs hover:underline hidden sm:block truncate max-w-[160px]"
                  style={{ color: "#787871" }}
                >
                  {c.email}
                </a>
              )}
              <ContactStatusBadge status={c.status as ContactStatus} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
