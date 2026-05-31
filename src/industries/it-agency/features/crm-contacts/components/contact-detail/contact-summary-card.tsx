"use client";

import { Mail, Phone, MessageSquare, FolderPlus, MoreHorizontal, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyButton } from "@/components/ui/copy-button";
import { ContactStatusBadge } from "../contact-status-badge";
import type { ContactStatus } from "@/types/database";

interface ContactSummaryCardProps {
  firstName: string | null;
  lastName: string | null;
  status: ContactStatus;
  email: string | null;
  phone: string | null;
  isAdmin: boolean;
  isPrimary: boolean;
  settingPrimary: boolean;
  onNoteClick: () => void;
  onAddToProject: () => void;
  onSetPrimary: () => void;
  onEditClick: () => void;
  onDeleteClick: () => void;
}

function getInitials(first: string | null, last: string | null): string {
  return ((first?.charAt(0) ?? "") + (last?.charAt(0) ?? "")).toUpperCase() || "?";
}

interface QuickActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  href?: string;
}

function QuickActionButton({ icon, label, onClick, disabled, href }: QuickActionButtonProps) {
  const inner = (
    <>
      <span className="h-10 w-10 rounded-full border border-border flex items-center justify-center text-muted-foreground group-hover:border-foreground group-hover:text-foreground group-disabled:hover:border-border group-disabled:hover:text-muted-foreground transition-colors">
        {icon}
      </span>
      <span className="text-xs text-muted-foreground group-hover:text-foreground group-disabled:hover:text-muted-foreground transition-colors">
        {label}
      </span>
    </>
  );

  if (href && !disabled) {
    return (
      <a href={href} className="flex flex-col items-center gap-1 group">
        {inner}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 group disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {inner}
    </button>
  );
}

export function ContactSummaryCard({
  firstName,
  lastName,
  status,
  email,
  phone,
  isAdmin,
  isPrimary,
  settingPrimary,
  onNoteClick,
  onAddToProject,
  onSetPrimary,
  onEditClick,
  onDeleteClick,
}: ContactSummaryCardProps) {
  const initials = getInitials(firstName, lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";

  return (
    <Card className="border border-border shadow-none rounded-lg py-0">
      <CardContent className="p-4">
        {/* Avatar and name */}
        <div className="flex flex-col items-center text-center mb-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-3">
            <span className="text-lg font-semibold text-muted-foreground">{initials}</span>
          </div>
          <h2 className="text-xl font-semibold" style={{ color: "#0f0f10" }}>{fullName}</h2>
          <div className="mt-2">
            <ContactStatusBadge status={status} />
          </div>
        </div>

        {/* Contact info */}
        <div className="space-y-2 mb-4">
          {email && (
            <div className="flex items-center justify-between group">
              <a
                href={`mailto:${email}`}
                className="text-sm truncate flex-1 hover:underline"
                style={{ color: "#787871" }}
              >
                {email}
              </a>
              <CopyButton value={email} label="Email" className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
          {phone && (
            <div className="flex items-center justify-between group">
              <a
                href={`tel:${phone}`}
                className="text-sm hover:underline"
                style={{ color: "#787871" }}
              >
                {phone}
              </a>
              <CopyButton value={phone} label="Phone" className="opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex items-center justify-center gap-3 pt-4 border-t border-border">
          <QuickActionButton
            icon={<MessageSquare className="h-4 w-4" />}
            label="Note"
            onClick={onNoteClick}
          />
          <QuickActionButton
            icon={<Mail className="h-4 w-4" />}
            label="Email"
            href={email ? `mailto:${email}` : undefined}
            disabled={!email}
          />
          <QuickActionButton
            icon={<Phone className="h-4 w-4" />}
            label="Call"
            href={phone ? `tel:${phone}` : undefined}
            disabled={!phone}
          />
          <QuickActionButton
            icon={<FolderPlus className="h-4 w-4" />}
            label="Add to Project"
            onClick={onAddToProject}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex flex-col items-center gap-1 group"
              >
                <span className="h-10 w-10 rounded-full border border-border flex items-center justify-center text-muted-foreground group-hover:border-foreground group-hover:text-foreground transition-colors">
                  <MoreHorizontal className="h-4 w-4" />
                </span>
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">More</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" style={{ "--dropdown-hover-overlay": "#0000170b" } as React.CSSProperties}>
              {!isPrimary && (
                <DropdownMenuItem
                  onClick={onSetPrimary}
                  disabled={settingPrimary}
                >
                  {settingPrimary && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Set as Primary Contact
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onEditClick}>
                Edit
              </DropdownMenuItem>
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onDeleteClick}
                    className="text-destructive focus:text-destructive"
                  >
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
