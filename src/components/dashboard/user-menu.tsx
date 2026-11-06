"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UsageRing } from "@/components/dashboard/usage-ring-svg";
import { roleChipText } from "@/components/dashboard/menu-text";
import { ringTitle, usageRingTone, type UsagePool } from "@/components/dashboard/usage-ring";
import type { AiUsage, SmsUsage } from "@/components/dashboard/use-usage-summary";
import {
  CaretDownIcon,
  ChatTextIcon,
  FileTextIcon,
  GearIcon,
  ProfileIcon,
  SearchIcon,
  SignOutIcon,
} from "@/components/dashboard/shell-icons";

interface UserMenuProps {
  userName: string;
  email: string;
  /** `positionName ?? role` */
  roleLabel: string;
  /** The user's branch, or "All branches". */
  branchLabel: string;
  tenantName: string;
  plan: string;
  isAdmin: boolean;
  aiOn: boolean;
  ai: AiUsage | null;
  aiPct: number | null;
  sms: SmsUsage | null;
  smsPct: number | null;
  ring: { pct: number; pool: UsagePool } | null;
  shortcutLabel: string;
  onOpen: () => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onLogout: () => void;
}

const TONE_TEXT = { ink: "text-ds-ink", warn: "text-ds-warn", bad: "text-ds-bad" } as const;
const TONE_BG = { ink: "bg-ds-ink", warn: "bg-ds-warn", bad: "bg-ds-bad" } as const;

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ds-faint">{children}</div>;
}

const ROW =
  "flex h-8 w-full items-center gap-2.5 rounded-ds-sm px-2 text-[13.5px] text-ds-text transition-colors hover:bg-ds-hover";

export function UserMenu(p: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const firstName = p.userName.split(" ")[0] || p.userName;
  const initials = initialsOf(p.userName);
  const close = () => setOpen(false);

  const avatar = (size: number, text: string) => (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-ds-ink font-semibold text-white",
        text,
      )}
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) p.onOpen();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Your menu"
          title={p.ring ? ringTitle(p.ring) : undefined}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-ds-sm border border-ds-border bg-ds-surface pl-0.5 pr-2 text-[12.5px] font-medium text-ds-ink outline-none transition-colors hover:bg-ds-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ds-accent data-[state=open]:bg-ds-hover max-md:pr-1.5"
        >
          {p.ring ? (
            <UsageRing pct={p.ring.pct} size={26}>
              {avatar(18, "text-[8.5px]")}
            </UsageRing>
          ) : (
            <span className="ml-0.5">{avatar(22, "text-[9.5px]")}</span>
          )}
          <span className="max-w-[120px] truncate max-md:hidden" title={p.userName}>
            {firstName}
          </span>
          <CaretDownIcon size={14} aria-hidden className="text-ds-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        collisionPadding={6}
        className="w-[304px] max-h-[calc(100vh-56px)] overflow-y-auto rounded-ds-md border-ds-border bg-ds-surface p-1.5 shadow-[var(--ds-shadow-float)] max-md:w-[calc(100vw-12px)]"
      >
        {/* 1. Identity */}
        <div className="flex items-center gap-2.5 p-2">
          {avatar(32, "text-[11.5px]")}
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-medium text-ds-ink" title={p.userName}>
              {p.userName}
            </div>
            <div className="truncate text-[12.5px] text-ds-muted" title={p.email}>
              {p.email}
            </div>
          </div>
        </div>
        <Badge
          look="v2"
          variant="neutral"
          title={roleChipText(p.roleLabel, p.branchLabel)}
          className="mx-2 mb-2 block w-fit max-w-[calc(100%-16px)] truncate"
        >
          {roleChipText(p.roleLabel, p.branchLabel)}
        </Badge>

        {p.isAdmin && (
          <>
            {/* 2. AI credits */}
            <div className="mx-0.5 my-1.5 rounded-[10px] border border-ds-border bg-ds-surface px-3 py-2.5">
              <div className="flex items-center gap-2 text-[13px] font-medium text-ds-ink">
                <UsageRing pct={p.aiOn ? (p.aiPct ?? null) : 0} size={30} arcClass="stroke-ds-ai-arc">
                  <span className="text-[9px] font-semibold tabular-nums text-ds-ink">
                    {p.aiOn ? (p.aiPct != null ? `${p.aiPct}%` : "–") : "0%"}
                  </span>
                </UsageRing>
                AI credits
                <Badge
                  look="v2"
                  variant="preview"
                  title="The allowance and Top up are placeholders until AI plans launch. Usage is real."
                >
                  Preview
                </Badge>
                <span className="ml-auto" title="Coming soon">
                  <Button look="v2" variant="secondary" size="sm" disabled className="h-6 text-xs text-ds-faint">
                    Top up
                  </Button>
                </span>
              </div>
              {p.aiOn ? (
                <>
                  <div className="mt-1 flex justify-between text-[12.5px] text-ds-muted">
                    <span>Used this month</span>
                    <b className="font-medium tabular-nums text-ds-ink">
                      {p.ai ? `${p.ai.requestsThisMonth.toLocaleString()} Orca requests` : "–"}
                    </b>
                  </div>
                  <div className="mt-1 flex justify-between text-[12.5px] text-ds-muted">
                    <span>Included in your plan</span>
                    <span className="text-ds-faint">set when plans launch</span>
                  </div>
                </>
              ) : (
                <div className="mt-1 text-xs text-ds-muted">
                  Orca is off for this workspace. Credits start when it&apos;s switched on.
                </div>
              )}
            </div>

            {/* 3. SMS credits */}
            {p.sms && p.smsPct != null && (
              <div className="mx-0.5 my-1.5 rounded-[10px] border border-ds-border bg-ds-surface px-3 py-2.5">
                <div className="flex items-center gap-2 text-[13px] font-medium text-ds-ink">
                  <ChatTextIcon size={14} aria-hidden className="text-ds-muted" />
                  SMS credits
                  <span className={cn("ml-auto text-[12.5px] tabular-nums", TONE_TEXT[usageRingTone(p.smsPct)])}>
                    {p.smsPct}% used
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-[12.5px] text-ds-muted">
                  <span>Remaining</span>
                  <b className="font-medium tabular-nums text-ds-ink">
                    {p.sms.balance.toLocaleString()} of {p.sms.granted.toLocaleString()}
                  </b>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-sm bg-ds-divider">
                  <div
                    className={cn("h-full", TONE_BG[usageRingTone(p.smsPct)])}
                    style={{ width: `${p.smsPct}%` }}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* 4. Workspace */}
        <div className="mx-0.5 my-1.5 rounded-[10px] border border-ds-border bg-ds-surface px-3 py-2.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <MenuLabel>Workspace</MenuLabel>
              <div className="mt-0.5 break-words text-[13.5px] font-medium text-ds-ink">{p.tenantName}</div>
              {p.isAdmin && <div className="text-[12.5px] text-ds-muted">{capitalise(p.plan)} plan</div>}
            </div>
            {p.isAdmin && (
              <span className="mt-3.5" title="Coming soon">
                <Button look="v2" variant="secondary" size="sm" disabled className="h-6 text-xs text-ds-faint">
                  Upgrade
                </Button>
              </span>
            )}
          </div>
        </div>

        {/* 5. Rows */}
        <div className="py-0.5">
          {p.isAdmin && (
            <button type="button" className={ROW} onClick={() => { close(); p.onOpenSettings(); }}>
              <GearIcon size={18} aria-hidden className="text-ds-muted" />
              Workspace settings
            </button>
          )}
          <button type="button" className={ROW} onClick={() => { close(); p.onOpenSearch(); }}>
            <SearchIcon size={18} aria-hidden className="text-ds-muted" />
            Search
            <kbd className="ml-auto rounded-[5px] border border-ds-border bg-ds-sunken px-[5px] text-[11px] font-medium text-ds-faint">
              {p.shortcutLabel}
            </kbd>
          </button>
          <div aria-disabled className={cn(ROW, "cursor-default text-ds-faint hover:bg-transparent")}>
            <ProfileIcon size={18} aria-hidden className="text-ds-ghost" />
            My profile
            <Badge look="v2" variant="neutral" className="ml-auto h-[18px] px-1.5 py-0 text-[10.5px] text-ds-faint">
              Soon
            </Badge>
          </div>
          {p.isAdmin && (
            <div aria-disabled className={cn(ROW, "cursor-default text-ds-faint hover:bg-transparent")}>
              <FileTextIcon size={18} aria-hidden className="text-ds-ghost" />
              Billing &amp; invoices
              <Badge look="v2" variant="neutral" className="ml-auto h-[18px] px-1.5 py-0 text-[10.5px] text-ds-faint">
                Soon
              </Badge>
            </div>
          )}
        </div>

        <hr className="-mx-1.5 my-1 border-0 border-t border-ds-divider" />
        {/* 6. Log out */}
        <button type="button" className={ROW} onClick={() => { close(); p.onLogout(); }}>
          <SignOutIcon size={18} aria-hidden className="text-ds-muted" />
          Log out
        </button>
      </PopoverContent>
    </Popover>
  );
}
