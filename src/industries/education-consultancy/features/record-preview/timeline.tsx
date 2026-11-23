"use client";

import { Fragment } from "react";
import { FileTextIcon, GearIcon } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { activityTime } from "./lib/labels";
import type { DateFmt } from "./lib/readiness";
import { initialsOf } from "./parts";
import type { PreviewActivity } from "./use-preview-data";

/**
 * Attio-style activity timeline (EDGEX-149 amendment). Box radius 12, 23px rows, a 1×8px #eeeff1 connector centred
 * under the 16px avatar between rows (pitch 31). People = round avatars with initials; system / form sources =
 * rounded squares (radius 30%) with a muted icon.
 */
const BOX = "rounded-[12px] px-[13px] py-[9px] shadow-[inset_0_0_0_1px_#eeeff1]";

function Connector() {
  return <div aria-hidden className="flex h-2 w-4 justify-center"><span className="h-2 w-px bg-[#eeeff1]" /></div>;
}

function TimelineAvatar({ person, initials, form }: { person: boolean; initials: string; form: boolean }) {
  return person ? (
    <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-[#eef0f3] text-[7px] font-semibold leading-none text-[#2b2d2f] shadow-[inset_0_0_0_1px_rgba(0,0,0,.06)]">
      {initials}
    </span>
  ) : (
    <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center rounded-[30%] bg-[#f6f7f7] text-[#6b6f76] shadow-[inset_0_0_0_1px_#e6e7ea]">
      {form ? <FileTextIcon className="size-[11px]" /> : <GearIcon className="size-[11px]" />}
    </span>
  );
}

export function Timeline({ rows, currentUserId, dateFormat }: { rows: PreviewActivity[]; currentUserId: string; dateFormat?: DateFmt }) {
  return (
    <div className={BOX}>
      {rows.map((a, i) => {
        const person = !!a.actor_id;
        const form = !person && (a.kind === "submission" || a.kind === "created");
        const actor = person ? (a.actor_id === currentUserId ? "You" : a.actor_name ?? "Someone") : a.source ?? "System";
        const verb = a.verb.charAt(0).toLowerCase() + a.verb.slice(1);
        return (
          <Fragment key={a.id}>
            {i > 0 && <Connector />}
            <div className="flex h-[23px] items-center gap-2 whitespace-nowrap text-[14px] font-medium leading-5">
              <TimelineAvatar person={person} initials={initialsOf(a.actor_name ?? actor)} form={form} />
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis">
                <b className="font-medium">{actor}</b>{" "}
                <em className="not-italic text-black/[.63]">{verb}{a.snippet ? ` · “${a.snippet}”` : ""}</em>
                {a.object ? <> {a.object}</> : null}
              </span>
              <span className="flex-none text-[12px] font-medium leading-4 text-black/50">{activityTime(a.at, new Date(), dateFormat)}</span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

export function TimelineSkeleton({ widths }: { widths: string[] }) {
  return (
    <div className={BOX}>
      {widths.map((w, i) => (
        <Fragment key={i}>
          {i > 0 && <Connector />}
          <div className="flex h-[23px] items-center"><Skeleton className="h-2.5 rounded-[5px]" style={{ width: w }} /></div>
        </Fragment>
      ))}
    </div>
  );
}
