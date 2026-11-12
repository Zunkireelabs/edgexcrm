"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  EnvelopeSimpleIcon, FileTextIcon, FunnelIcon, GearIcon, NoteIcon, PhoneIcon, PlusIcon, UserCheckIcon, UsersIcon, ClockIcon,
} from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ActivityType } from "@/types/database";
import { initialsOf } from "../record-preview/parts";
import {
  CHIP_LABEL, CHIP_ORDER, QUOTE_KINDS, chipCounts, clock, filterFeed, groupByDay, type ChipId, type FeedItem,
} from "./lib/activity-merge";
import { EmptyState } from "./ui";
import { rememberOrigin } from "./focus-origin";

const BORDERED = "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-white px-2 text-[14px] font-medium leading-5 text-[#101112] shadow-[inset_0_0_0_1px_#e8e9eb] outline-none hover:bg-[#f6f7f9] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 [&_svg]:size-[14px]";
const MENU_ITEM = "h-8 gap-2 rounded-[8px] px-2 text-[14px] font-medium";

function kindIcon(kind: string): ReactNode {
  switch (kind) {
    case "note": return <NoteIcon className="size-[14px]" />;
    case "checkin": return <UserCheckIcon className="size-[14px]" />;
    case "call": case "meeting": return <PhoneIcon className="size-[14px]" />;
    case "email": return <EnvelopeSimpleIcon className="size-[14px]" />;
    case "assigned": case "unassigned": return <UsersIcon className="size-[14px]" />;
    case "created": case "submission": return <FileTextIcon className="size-[14px]" />;
    default: return <GearIcon className="size-[14px]" />;
  }
}

function Row({ it, currentUserId, last }: { it: FeedItem; currentUserId: string; last: boolean }) {
  const person = !!it.actor_id;
  const actor = person ? (it.actor_id === currentUserId ? "You" : it.actor_name ?? "Someone") : it.source ?? "System";
  const verb = it.verb.charAt(0).toLowerCase() + it.verb.slice(1);
  const iconOnly = !person || it.kind === "note" || it.kind === "checkin";
  return (
    <div className="flex gap-2.5 px-1 pt-1.5">
      {/* Attio-style thread: a 1px #eeeff1 line (the record preview timeline's connector) links this item's avatar to the next one's, through the quote box. None after the last item of a day group. */}
      <div className="flex flex-none flex-col items-center">
        <span aria-hidden className={cn("inline-flex size-6 flex-none items-center justify-center rounded-full bg-[#f6f7f7] text-[9px] font-semibold text-[#6b6f76] shadow-[inset_0_0_0_1px_#e6e7ea]", !iconOnly && "bg-[#eef0f3] text-[#2b2d2f]")}>
          {iconOnly ? kindIcon(it.kind) : initialsOf(it.actor_name ?? actor)}
        </span>
        {!last && <span aria-hidden data-connector className="mt-0.5 w-px flex-1 bg-[#eeeff1]" />}
      </div>
      <div className={cn("min-w-0 flex-1", last ? "pb-1.5" : "pb-3")}>
        <div className="flex gap-1.5 text-[14px] leading-5">
          <span className="min-w-0 flex-1">
            <b className="font-medium">{actor}</b>{" "}
            <em className="not-italic text-black/[.63]">{verb}</em>
            {it.object ? <> {it.object}</> : null}
            {!QUOTE_KINDS.has(it.kind) && it.snippet ? <em className="not-italic text-black/[.63]"> · “{it.snippet}”</em> : null}
          </span>
          <span className="flex-none text-[12px] font-medium leading-5 text-black/50">{clock(it.at)}</span>
        </div>
        {QUOTE_KINDS.has(it.kind) && it.snippet && (
          <div className="mt-1.5 whitespace-pre-wrap break-words rounded-[8px] bg-[#f6f7f9] px-2.5 py-2 text-[13px] font-normal leading-[18px] text-[#2b2d2f]">{it.snippet}</div>
        )}
      </div>
    </div>
  );
}

const EMPTY: Record<Exclude<ChipId, "all">, { title: string; line: string }> = {
  calls: { title: "No calls or meetings yet", line: "Log a call or a meeting to keep the conversation on the record." },
  notes: { title: "No notes yet", line: "Notes you add show up here and in the Notes tab." },
  emails: { title: "No emails yet", line: "Emails sent to or received from this lead show up here." },
  stage: { title: "No stage or owner changes", line: "Moves between stages and reassignments show up here." },
  checkins: { title: "No check-ins yet", line: "Walk-in visits recorded at the front desk show up here." },
};

/** Activity tab (EDGEX-153): header + Filter + Log activity, filter chips with counts, ONE merged timeline grouped by day. */
export function ActivityTab({ feed, currentUserId, onLog, onAddNote, onCheckIn }: {
  feed: FeedItem[] | null;
  currentUserId: string;
  onLog: (t: ActivityType) => void;
  onAddNote: () => void;
  /** Check-in (only when the tenant has the check-in feature). */
  onCheckIn?: () => void;
}) {
  const [chip, setChip] = useState<ChipId>("all");
  const logTriggerRef = useRef<HTMLButtonElement>(null);
  // A dialog opened from the "Log activity" menu hands focus back to that menu's button.
  const viaLogMenu = (fn: () => void) => () => { rememberOrigin(logTriggerRef.current); fn(); };
  const counts = useMemo(() => chipCounts(feed ?? []), [feed]);
  const groups = useMemo(() => groupByDay(filterFeed(feed ?? [], chip)), [feed, chip]);

  return (
    <div className="px-4 pb-4 pt-1">
      <div className="mt-3 flex items-center gap-2">
        <h3 className="m-0 text-[14px] font-medium leading-5">Activity</h3>
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger className={BORDERED}><FunnelIcon aria-hidden />Filter</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px] rounded-[12px] p-1">
            {CHIP_ORDER.map((c) => (
              <DropdownMenuItem key={c} onSelect={() => setChip(c)} className={cn(MENU_ITEM, chip === c && "bg-[#f6f7f9]")}>
                {CHIP_LABEL[c]}<span className="ml-auto text-[12px] text-black/50">{counts[c]}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger ref={logTriggerRef} className={BORDERED}><PlusIcon aria-hidden />Log activity</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[260px] rounded-[12px] p-1">
            <DropdownMenuItem className={MENU_ITEM} onSelect={viaLogMenu(() => onLog("call"))}><PhoneIcon className="size-4" />Call</DropdownMenuItem>
            <DropdownMenuItem className={MENU_ITEM} onSelect={viaLogMenu(() => onLog("meeting"))}><ClockIcon className="size-4" />Meeting</DropdownMenuItem>
            <DropdownMenuItem className={MENU_ITEM} onSelect={viaLogMenu(() => onLog("email"))}><EnvelopeSimpleIcon className="size-4" />Email (sent outside EdgeX)</DropdownMenuItem>
            <DropdownMenuItem className={MENU_ITEM} onSelect={viaLogMenu(onAddNote)}><NoteIcon className="size-4" />Note</DropdownMenuItem>
            {onCheckIn && <DropdownMenuItem className={MENU_ITEM} onSelect={viaLogMenu(onCheckIn)}><UserCheckIcon className="size-4" />Check-in</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div role="group" aria-label="Filter activity" className="mt-3 flex flex-wrap gap-1.5">
        {CHIP_ORDER.map((c) => (
          <button
            key={c} type="button" aria-pressed={chip === c} onClick={() => setChip(c)}
            className={cn(
              "inline-flex h-[26px] items-center gap-1.5 rounded-[8px] px-2 text-[13px] font-medium shadow-[inset_0_0_0_1px_#e8e9eb] outline-none focus-visible:ring-2 focus-visible:ring-[#266df0]/50",
              chip === c ? "bg-[#f6f7f9] text-[#101112]" : "bg-white text-black/[.63] hover:text-[#101112]",
            )}
          >
            {CHIP_LABEL[c]}<span className="text-black/50">{counts[c]}</span>
          </button>
        ))}
      </div>

      {feed === null ? (
        <div className="mt-4 space-y-3" aria-busy="true">
          {["60%", "45%", "52%", "40%"].map((w, i) => <Skeleton key={i} className="h-3 rounded-[5px]" style={{ width: w }} />)}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={kindIcon(chip === "calls" ? "call" : chip === "notes" ? "note" : chip === "emails" ? "email" : chip === "checkins" ? "checkin" : "stage")}
          title={chip === "all" ? "No activity yet" : EMPTY[chip].title}
          line={chip === "all" ? "Notes, calls, emails and stage moves show up here." : EMPTY[chip].line}
          cta={chip === "calls" ? "Log a call" : chip === "notes" ? "Add a note" : chip === "emails" ? "Log an email" : undefined}
          onCta={chip === "calls" ? () => onLog("call") : chip === "notes" ? onAddNote : chip === "emails" ? () => onLog("email") : undefined}
        />
      ) : (
        groups.map((g) => (
          <div key={g.label}>
            <div className="mx-1 mb-1.5 mt-4 text-[12px] font-medium leading-4 text-black/50">{g.label}</div>
            {g.items.map((it, i) => <Row key={it.id} it={it} currentUserId={currentUserId} last={i === g.items.length - 1} />)}
          </div>
        ))
      )}
    </div>
  );
}
