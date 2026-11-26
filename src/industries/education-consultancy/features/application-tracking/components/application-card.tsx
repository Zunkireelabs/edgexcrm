"use client";

import { useRef } from "react";
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BookOpenIcon,
  CalendarIcon,
  CheckSquareIcon,
  ClockIcon,
  DotsThreeIcon,
  FileTextIcon,
  GraduationCapIcon,
  MapPinIcon,
  UserIcon,
} from "@/components/icons";
import type { Application } from "@/types/database";
import { normalizeDestinations } from "@/lib/leads/destination-normalize";
import { ageTone, daysInStage, resolveCounsellor, type AgeTone } from "../lib/card-metrics";

interface ApplicationCardProps {
  application: Application;
  disabled: boolean;
  onOpenDetail?: (app: Application) => void;
  /** user_id -> display name, to resolve the counsellor. */
  assigneeNames?: Record<string, string>;
  /** The stage is a finished one: the age pill is always neutral. */
  finished?: boolean;
  /** Show the time-in-stage pill (per-column "Track time in stage" pref). */
  showAge?: boolean;
  /**
   * Phone board, admins only (EDGEX-141 Phase 5): a 32px "⋯" in the title row and a 500ms long-press
   * open the Move to stage sheet. Omitted (desktop, read-only users) = no button, long-press does nothing.
   */
  onMoveRequest?: (app: Application) => void;
}

/** Long-press to open the Move sheet (mockup state 3). */
export const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 8;

const AVATAR_COLORS = [
  { bg: "#e8f1fb", fg: "#1f5d94" },
  { bg: "#efeafc", fg: "#5b47d6" },
  { bg: "#e9f6ef", fg: "#127a4a" },
  { bg: "#fdf3e3", fg: "#a15c07" },
  { bg: "#fdeeec", fg: "#b42318" },
  { bg: "#e6f6f8", fg: "#0e7490" },
];

export function colorFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

const AGE_STYLES: Record<AgeTone, string> = {
  neutral: "text-[rgba(0,0,0,.63)]",
  amber: "bg-[#fdf3e3] text-[#a15c07]",
  red: "bg-[#fdeeec] text-[#b42318]",
};

function studentOf(app: Application) {
  const lead = app.leads;
  const full = lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") : "";
  return full || "Unknown student";
}

type CardBodyProps = Pick<ApplicationCardProps, "application" | "assigneeNames" | "finished" | "showAge" | "onMoveRequest">;

/** The card's face: no dnd hooks, so the DragOverlay clone can reuse it without registering a second sortable. */
function CardBody({ application, assigneeNames, finished = false, showAge = true, onMoveRequest }: CardBodyProps) {
  const leadId = application.leads?.id ?? application.lead_id;
  const student = studentOf(application);
  const counsellor = resolveCounsellor(application, assigneeNames);
  const avatar = counsellor ? colorFor(counsellor.name) : null;
  const days = daysInStage(application.stage_changed_at);
  const tone = ageTone(days, finished);
  const countries = normalizeDestinations(application.countries ?? []);
  const openTasks = application.open_task_count ?? 0;
  const docs = application.doc_count ?? 0;

  return (
    <>
      <div className={`flex items-center gap-2 pt-[10px] pb-[6px] pl-3 ${onMoveRequest ? "pr-1" : "pr-2"}`}>
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[#f6f7f9] text-[#6b6f76]">
          <GraduationCapIcon className="h-3 w-3" />
        </span>
        <span className="truncate text-[14px] leading-[1.4] font-medium text-[#101112]">{application.university_name}</span>
        {onMoveRequest && (
          <button
            type="button"
            title="Move to stage"
            aria-label={`Move ${student} to another stage`}
            data-testid="card-move"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onMoveRequest(application);
            }}
            className="-my-1.5 ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-[#9a9ea5] hover:bg-black/5 hover:text-[#101112]"
          >
            <DotsThreeIcon className="size-[15px]" />
          </button>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2 px-3 py-[3px] text-[13px] leading-[1.4] text-[#6b6f76]">
        <BookOpenIcon className="h-[14px] w-[14px] shrink-0 text-[#9a9ea5]" />
        <span className="truncate">{application.program_name}</span>
      </div>

      <div className="flex min-w-0 items-center gap-2 px-3 py-[3px] text-[13px] leading-[1.4] text-[#2b2d2f]">
        <UserIcon className="h-[14px] w-[14px] shrink-0 text-[#9a9ea5]" />
        <Link
          href={`/leads/${leadId}`}
          prefetch={false}
          onClick={(e) => e.stopPropagation()}
          className="truncate hover:underline"
        >
          {student}
        </Link>
      </div>

      <div className="flex min-w-0 items-center gap-2 px-3 py-[3px] text-[13px] leading-[1.4] text-[#2b2d2f]">
        {counsellor && avatar ? (
          <>
            <span
              className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold tracking-[.02em]"
              style={{ background: avatar.bg, color: avatar.fg }}
            >
              {counsellor.initials}
            </span>
            <span className="truncate">{counsellor.name}</span>
          </>
        ) : (
          <>
            <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#f6f7f9] text-[#9a9ea5]">
              <UserIcon className="h-[11px] w-[11px]" />
            </span>
            <span className="text-[rgba(0,0,0,.42)]">Set assignee</span>
          </>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2 overflow-hidden px-3 py-[3px] text-[13px] leading-[1.4] whitespace-nowrap text-[#2b2d2f]">
        <CalendarIcon className="h-[14px] w-[14px] shrink-0 text-[#9a9ea5]" />
        {application.intake_term ? (
          <span className="min-w-0 truncate">{application.intake_term}</span>
        ) : (
          <span className="shrink-0 text-[rgba(0,0,0,.42)]">Set intake</span>
        )}
        {countries.length > 0 && (
          <>
            <span className="shrink-0 text-[#6b6f76]">·</span>
            <MapPinIcon className="h-[14px] w-[14px] shrink-0 text-[#9a9ea5]" />
            <span className="min-w-0 truncate text-[#6b6f76]">{countries.join(", ")}</span>
          </>
        )}
      </div>

      {application.offer_type && (
        <span
          className={`mt-1 ml-3 inline-flex h-5 items-center rounded-[6px] px-[7px] text-[11.5px] font-medium ${
            application.offer_type === "unconditional"
              ? "bg-[#e9f6ef] text-[#127a4a]"
              : "bg-[#fdf3e3] text-[#a15c07]"
          }`}
        >
          {application.offer_type === "unconditional" ? "Unconditional offer" : "Conditional offer"}
        </span>
      )}

      <div className="mt-[6px] flex items-center gap-3 pt-2 pr-[10px] pb-[9px] pl-3 text-[12px] text-[#9a9ea5] tabular-nums">
        <span
          className="inline-flex items-center gap-1"
          title={`${docs} ${docs === 1 ? "document" : "documents"} uploaded`}
        >
          <FileTextIcon className="h-[13px] w-[13px]" />
          {docs}
        </span>
        {openTasks > 0 && (
          <span
            className="inline-flex items-center gap-1"
            title={`${openTasks} open ${openTasks === 1 ? "task" : "tasks"} for ${student}`}
          >
            <CheckSquareIcon className="h-[13px] w-[13px]" />
            {openTasks}
          </span>
        )}
        {showAge && (
          <span
            data-testid="age-pill"
            className={`ml-auto inline-flex h-5 items-center gap-1 rounded-[6px] px-1.5 text-[12px] font-medium tabular-nums ${AGE_STYLES[tone]}`}
            title={`In this stage since ${new Date(application.stage_changed_at).toLocaleDateString()}`}
          >
            <ClockIcon className="h-3 w-3" />
            {days}d
          </span>
        )}
      </div>
    </>
  );
}

export function ApplicationCard({
  application,
  disabled,
  onOpenDetail,
  assigneeNames,
  finished = false,
  showAge = true,
  onMoveRequest,
}: ApplicationCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: application.id,
    disabled,
  });

  const style = { transform: CSS.Transform.toString(transform), transition };

  // Long-press (phone): fires after LONG_PRESS_MS unless the finger moves (a swipe/scroll) or lifts.
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const firedRef = useRef(false);
  function cancelPress() {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }
  const longPress = onMoveRequest
    ? {
        onPointerDown(e: React.PointerEvent) {
          firedRef.current = false;
          cancelPress();
          press.current = {
            x: e.clientX,
            y: e.clientY,
            timer: setTimeout(() => {
              press.current = null;
              firedRef.current = true;
              onMoveRequest(application);
            }, LONG_PRESS_MS),
          };
        },
        onPointerMove(e: React.PointerEvent) {
          const p = press.current;
          if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > LONG_PRESS_SLOP_PX) cancelPress();
        },
        onPointerUp: cancelPress,
        onPointerCancel: cancelPress,
        onPointerLeave: cancelPress,
        onContextMenu(e: React.MouseEvent) {
          e.preventDefault();
        },
      }
    : null;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenDetail?.(application);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, boxShadow: "0 0 0 1px rgba(0,0,0,.06)" }}
      {...attributes}
      {...listeners}
      {...longPress}
      onClick={() => {
        // The click that ends a long-press opened the Move sheet; it doesn't also open the detail.
        if (firedRef.current) {
          firedRef.current = false;
          return;
        }
        onOpenDetail?.(application);
      }}
      onKeyDown={handleKeyDown}
      data-testid="application-card"
      data-app-id={application.id}
      className={`shrink-0 rounded-[12px] bg-white transition-shadow ${
        isDragging ? "opacity-50" : "hover:!shadow-[0_0_0_1px_rgba(0,0,0,.1),0_1px_2px_rgba(0,0,0,.05)]"
      } ${disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"}${onMoveRequest ? " select-none [-webkit-touch-callout:none]" : ""}`}
    >
      <CardBody
        application={application}
        assigneeNames={assigneeNames}
        finished={finished}
        showAge={showAge}
        onMoveRequest={onMoveRequest}
      />
    </div>
  );
}

/**
 * The DragOverlay clone (EDGEX-169). Presentational only: dnd-kit requires the overlay never to use the
 * sortable's id, and a second useSortable({id}) here fought the real card for that id's rect measuring.
 */
export function ApplicationCardOverlay({ application, assigneeNames, finished = false, showAge = true }: Omit<ApplicationCardProps, "disabled" | "onOpenDetail" | "onMoveRequest">) {
  return (
    <div
      style={{ boxShadow: "0 0 0 1px rgba(0,0,0,.06)" }}
      data-testid="application-card-overlay"
      className="shrink-0 cursor-default rounded-[12px] bg-white transition-shadow"
    >
      <CardBody application={application} assigneeNames={assigneeNames} finished={finished} showAge={showAge} />
    </div>
  );
}
