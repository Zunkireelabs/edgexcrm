"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BookOpenIcon,
  CalendarIcon,
  CheckSquareIcon,
  ClockIcon,
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
}

const AVATAR_COLORS = [
  { bg: "#e8f1fb", fg: "#1f5d94" },
  { bg: "#efeafc", fg: "#5b47d6" },
  { bg: "#e9f6ef", fg: "#127a4a" },
  { bg: "#fdf3e3", fg: "#a15c07" },
  { bg: "#fdeeec", fg: "#b42318" },
  { bg: "#e6f6f8", fg: "#0e7490" },
];

function colorFor(name: string) {
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

export function ApplicationCard({
  application,
  disabled,
  onOpenDetail,
  assigneeNames,
  finished = false,
  showAge = true,
}: ApplicationCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: application.id,
    disabled,
  });

  const style = { transform: CSS.Transform.toString(transform), transition };

  const leadId = application.leads?.id ?? application.lead_id;
  const student = studentOf(application);
  const counsellor = resolveCounsellor(application, assigneeNames);
  const avatar = counsellor ? colorFor(counsellor.name) : null;
  const days = daysInStage(application.stage_changed_at);
  const tone = ageTone(days, finished);
  const countries = normalizeDestinations(application.countries ?? []);
  const openTasks = application.open_task_count ?? 0;
  const docs = application.doc_count ?? 0;

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
      onClick={() => onOpenDetail?.(application)}
      onKeyDown={handleKeyDown}
      data-testid="application-card"
      className={`shrink-0 rounded-[12px] bg-white transition-shadow ${
        isDragging ? "opacity-50" : "hover:!shadow-[0_0_0_1px_rgba(0,0,0,.1),0_1px_2px_rgba(0,0,0,.05)]"
      } ${disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
    >
      <div className="flex items-center gap-2 pt-[10px] pr-2 pb-[6px] pl-3">
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[#f6f7f9] text-[#6b6f76]">
          <GraduationCapIcon className="h-3 w-3" />
        </span>
        <span className="truncate text-[14px] leading-[1.4] font-medium text-[#101112]">{application.university_name}</span>
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
            <span className="text-[rgba(0,0,0,.42)]">Set counsellor</span>
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
    </div>
  );
}
