"use client";

import { Building2, FolderPlus, UserPlus, Mail, MoreHorizontal, Loader2, UserRound, X } from "lucide-react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface AccountContact {
  id: string;
  first_name: string;
  last_name: string;
}

interface AccountSummaryCardProps {
  name: string;
  isActive: boolean;
  primaryContactId: string | null;
  primaryContact: AccountContact | null;
  ownerEmail: string | null;
  primaryContactEmail: string | null;
  isAdmin: boolean;
  contacts: AccountContact[];
  settingPrimary: boolean;
  togglingActive: boolean;
  onSetPrimary: (id: string | null) => void;
  onToggleActive: () => void;
  onEditClick: () => void;
  onDeleteClick: () => void;
  onCreateProject: () => void;
  onCreateContact: () => void;
  primaryPickerOpen: boolean;
  onPrimaryPickerOpenChange: (open: boolean) => void;
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

export function AccountSummaryCard({
  name,
  isActive,
  primaryContactId,
  primaryContact,
  ownerEmail,
  primaryContactEmail,
  isAdmin,
  contacts,
  settingPrimary,
  togglingActive,
  onSetPrimary,
  onToggleActive,
  onEditClick,
  onDeleteClick,
  onCreateProject,
  onCreateContact,
  primaryPickerOpen,
  onPrimaryPickerOpenChange,
}: AccountSummaryCardProps) {
  const primaryContactName = primaryContact
    ? `${primaryContact.first_name} ${primaryContact.last_name}`.trim()
    : null;

  return (
    <Card className="border border-border shadow-none rounded-lg py-0">
      <CardContent className="p-4">
        {/* Avatar and name */}
        <div className="flex flex-col items-center text-center mb-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-3">
            <Building2 className="h-7 w-7 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold" style={{ color: "#0f0f10" }}>{name}</h2>
          <div className="mt-2">
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
              }`}
            >
              {isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>

        {/* Primary contact + owner pills */}
        <div className="space-y-2 mb-4">
          {/* Primary contact picker */}
          <div className="flex items-center gap-1.5">
            <UserRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {isAdmin ? (
              <Popover open={primaryPickerOpen} onOpenChange={onPrimaryPickerOpenChange}>
                <PopoverTrigger asChild>
                  <button type="button" className="text-sm text-left group flex-1">
                    {primaryContactName ? (
                      <span className="font-medium hover:underline cursor-pointer" style={{ color: "#0f0f10" }}>
                        {primaryContactName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground hover:text-foreground cursor-pointer text-sm">
                        Set primary contact
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-2" align="start">
                  <p className="text-xs font-medium text-muted-foreground px-2 py-1 mb-1">
                    Primary contact
                  </p>
                  {contacts.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-2 py-1">
                      No contacts on this account yet.
                    </p>
                  ) : (
                    <ul className="space-y-0.5">
                      {contacts.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => onSetPrimary(c.id)}
                            disabled={settingPrimary}
                            className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors flex items-center justify-between ${
                              primaryContactId === c.id ? "font-medium" : ""
                            }`}
                          >
                            <span>{`${c.first_name} ${c.last_name}`.trim()}</span>
                            {primaryContactId === c.id && (
                              <span className="text-xs text-green-600">✓</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {primaryContactId && (
                    <>
                      <div className="border-t my-1.5" />
                      <button
                        type="button"
                        onClick={() => onSetPrimary(null)}
                        disabled={settingPrimary}
                        className="w-full text-left px-2 py-1.5 rounded text-sm text-muted-foreground hover:text-destructive hover:bg-muted transition-colors flex items-center gap-1.5"
                      >
                        <X className="h-3.5 w-3.5" />
                        Clear primary contact
                      </button>
                    </>
                  )}
                  {settingPrimary && (
                    <div className="flex justify-center py-1">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    </div>
                  )}
                </PopoverContent>
              </Popover>
            ) : (
              primaryContactId && primaryContact ? (
                <Link
                  href={`/contacts/${primaryContactId}`}
                  className="text-sm font-medium hover:underline"
                  style={{ color: "#0f0f10" }}
                >
                  {primaryContactName}
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">No primary contact</span>
              )
            )}
          </div>

          {/* Owner */}
          {ownerEmail && (
            <div className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm truncate" style={{ color: "#787871" }}>{ownerEmail}</span>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex items-center justify-center gap-3 pt-4 border-t border-border">
          <QuickActionButton
            icon={<FolderPlus className="h-4 w-4" />}
            label="+ Project"
            onClick={onCreateProject}
            disabled={!isAdmin}
          />
          <QuickActionButton
            icon={<UserPlus className="h-4 w-4" />}
            label="+ Contact"
            onClick={onCreateContact}
            disabled={!isAdmin}
          />
          <QuickActionButton
            icon={<Mail className="h-4 w-4" />}
            label="Email"
            href={primaryContactEmail ? `mailto:${primaryContactEmail}` : undefined}
            disabled={!primaryContactEmail}
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
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEditClick} disabled={!isAdmin}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleActive} disabled={!isAdmin || togglingActive}>
                {togglingActive && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isActive ? "Deactivate" : "Activate"}
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
