"use client";

// Applications List view (EDGEX-141 Phase 4, mockup temp_ss/applications-list-v1.html): the Leads v2
// table metrics (shared grid-styles, column menu, View settings, pagination) over the board's
// filtered index. No filler column: like the mockup, the fixed-layout table stretches its columns
// across the width once it is wider than their sum (min-width = the sum). Pages come from GET /api/v1/applications/board-page (no stage) with the same URL
// state the board uses; the footer summaries come back with every page.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlarmIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  BookOpenIcon,
  CalendarCheckIcon,
  CalendarIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ClockIcon,
  FileTextIcon,
  GlobeIcon,
  GraduationCapIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  TagIcon,
  TargetIcon,
  TimerIcon,
  UserIcon,
  WalletIcon,
  type Icon,
} from "@/components/icons";
import { Checkbox } from "@/components/ui/checkbox";
import { CELL_BASE, CELL_BASE_NAME, CHECKBOX_CLASS, HEAD_BASE, NAME_CLIP, NAME_EDGE } from "@/components/data-grid/grid-styles";
import { CHECKBOX_WIDTH, canMove, hideColumn, moveColumn, type ColumnLayout } from "@/components/dashboard/leads/table/grid-layout";
import { ColumnHeaderMenu, type ColumnMenuModel } from "@/components/dashboard/leads/table/column-header-menu";
import { GridPagination } from "@/components/dashboard/leads/table/grid-pagination";
import { formatAgo } from "@/components/dashboard/leads/table/format-ago";
import { normalizeDestinations } from "@/lib/leads/destination-normalize";
import type { Application, ApplicationStage } from "@/types/database";
import { SORT_BY_FIELD, sortFieldOf, type ApplicationSort, type ApplicationSortField } from "../lib/applications-query";
import { LIST_PAGE_SIZES, daysUntilDeadline, deadlineTone, ymdInTz, type ListSummary } from "../lib/board-index";
import { ageTone, daysInStage, initialsOf, isFinishedStage, resolveCounsellor, type AgeTone } from "../lib/card-metrics";
import {
  LIST_COLUMNS,
  STUDENT_WIDTH,
  bulkToast,
  headerCheckState,
  pageWindow,
  runBulkPatch,
  toggleId,
  togglePage,
  type ListColumnKey,
} from "../lib/list-view";
import { colorFor } from "./application-card";
import { matchesBelowMd } from "../hooks/use-below-md";
import { ListPicker, type PickerGroup } from "./list-picker";

export const LIST_COLUMN_ICONS: Record<ListColumnKey, Icon> = {
  university: GraduationCapIcon,
  program: BookOpenIcon,
  stage: TargetIcon,
  time_in_stage: TimerIcon,
  counsellor: UserIcon,
  intake: CalendarIcon,
  deadline: AlarmIcon,
  docs: FileTextIcon,
  country: GlobeIcon,
  updated: ArrowsClockwiseIcon,
  offer_type: TagIcon,
  fee_paid: WalletIcon,
  open_tasks: ListChecksIcon,
  created: CalendarCheckIcon,
};

/** A View-settings column (PopoverColumn shape). */
export const LIST_POPOVER_COLUMNS = (Object.keys(LIST_COLUMNS) as ListColumnKey[]).map((k) => ({
  key: k,
  label: LIST_COLUMNS[k].label,
  v2: { icon: LIST_COLUMN_ICONS[k] },
}));

export interface ListPage {
  rows: Application[];
  total: number;
  summary: ListSummary | null;
  truncated: boolean;
}

export interface ApplicationsListProps {
  /** The board's URL state (f, q, sort, tab, pipeline): one string, so any change refetches. */
  stateQuery: string;
  fetchPage: (offset: number, limit: number) => Promise<ListPage>;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  layout: ColumnLayout;
  onLayoutChange: (next: ColumnLayout) => void;
  sort: ApplicationSort;
  onSort: (s: ApplicationSort) => void;
  /** Column menu "Filter by …" (the toolbar's filter-request nonce). */
  onFilterRequest: (fieldKey: string) => void;
  filterFieldKeys: Set<string>;
  /** Stages of the selected pipeline (picker: active first, then Finished). */
  stages: ApplicationStage[];
  teamMembers: { user_id: string; name: string; email: string }[];
  assigneeNames: Record<string, string>;
  canManageApplications: boolean;
  /** Admin bulk actions (hidden for counsellors, Phase 3 own-scope note). */
  bulkAllowed: boolean;
  timezone: string;
  detailHref: (appId: string) => string;
  /** Something narrows the list (chips, search, tab): the empty state is "No applications match". */
  filtersActive: boolean;
  onClearFilters: () => void;
  /** A write landed: refresh server props (header counts, tabs). */
  onChanged: () => void;
  /** Reports the total + summary to the parent once a page loads. */
  onLoaded?: (p: { total: number; truncated: boolean }) => void;
  /** Test seam. */
  fetchImpl?: typeof fetch;
  /**
   * Below md (EDGEX-141 Phase 5, mockup state 6): 72px stacked rows instead of the table, a sticky
   * "1–25 of N" pager; no checkboxes, bulk bar, column menu, footer summaries or page-size picker.
   * Same server paging and the user's stored page size.
   */
  phone?: boolean;
}

const AGE_CLASS: Record<AgeTone, string> = {
  neutral: "bg-ds-hover text-ds-muted",
  amber: "bg-ds-warn-soft text-ds-warn",
  red: "bg-ds-bad-soft text-ds-bad",
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function studentName(app: Application): string {
  const l = app.leads;
  return (l ? [l.first_name, l.last_name].filter(Boolean).join(" ") : "") || "Unknown student";
}

function formatDay(date: string | null): string {
  if (!date) return "—";
  const t = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function Avatar({ initials, bg, fg }: { initials: string; bg: string; fg: string }) {
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold" style={{ background: bg, color: fg }}>
      {initials}
    </span>
  );
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

interface CellCtx {
  stageById: Map<string, ApplicationStage>;
  assigneeNames: Record<string, string>;
  today: string;
  now: number;
  canManage: boolean;
  onStageCell: (app: Application, el: HTMLElement) => void;
}

function cellFor(key: ListColumnKey, app: Application, c: CellCtx): ReactNode {
  switch (key) {
    case "university":
      return (
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-ds-hover text-ds-muted">
            <GraduationCapIcon className="size-[13px]" />
          </span>
          <span className="truncate">{app.university_name}</span>
        </div>
      );
    case "program":
      return <span className="text-ds-muted">{app.program_name || "—"}</span>;
    case "stage": {
      const st = c.stageById.get(app.placed_stage_id ?? app.stage_id);
      const inner = (
        <>
          <span className="size-2 shrink-0 rounded-full" style={{ background: st?.color ?? "#9a9ea5" }} />
          <span className="truncate">{st?.name ?? "—"}</span>
        </>
      );
      return c.canManage ? (
        <button
          type="button"
          data-testid="stage-cell"
          aria-haspopup="listbox"
          onClick={(e) => c.onStageCell(app, e.currentTarget)}
          className="-mx-1.5 inline-flex h-6 max-w-[calc(100%+12px)] items-center gap-2 rounded-[6px] px-1.5 hover:bg-[#eef0f3] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost"
        >
          {inner}
        </button>
      ) : (
        <span data-testid="stage-cell-readonly" className="inline-flex h-6 items-center gap-2">
          {inner}
        </span>
      );
    }
    case "time_in_stage": {
      const days = daysInStage(app.stage_changed_at, c.now);
      const tone = ageTone(days, isFinishedStage(c.stageById.get(app.placed_stage_id ?? app.stage_id)));
      return (
        <span data-testid="age-pill" data-tone={tone} className={`inline-flex items-center rounded-[6px] px-1.5 text-xs font-medium leading-5 tabular-nums ${AGE_CLASS[tone]}`}>
          {days}d
        </span>
      );
    }
    case "counsellor": {
      const who = resolveCounsellor(app, c.assigneeNames);
      if (!who) return <span className="text-ds-faint">Set counsellor</span>;
      const col = colorFor(who.name);
      return (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar initials={who.initials} bg={col.bg} fg={col.fg} />
          <span className="truncate">{who.name}</span>
        </div>
      );
    }
    case "intake":
      return app.intake_term || <span className="text-ds-faint">—</span>;
    case "deadline": {
      const tone = deadlineTone(app.application_deadline, c.today);
      const cls = tone === "past" ? "text-ds-bad" : tone === "soon" ? "text-ds-warn" : tone === "none" ? "text-ds-faint" : "";
      return (
        <span data-testid="deadline" data-tone={tone} className={cls} title={app.application_deadline ?? undefined}>
          {formatDay(app.application_deadline)}
        </span>
      );
    }
    case "docs":
      return <span className="tabular-nums text-ds-muted">{app.doc_count ?? 0}</span>;
    case "country": {
      const list = normalizeDestinations(app.countries ?? []);
      return list.length ? list.join(", ") : <span className="text-ds-faint">—</span>;
    }
    case "updated":
      return <span className="text-ds-muted">{formatAgo(app.updated_at, c.now)}</span>;
    case "created":
      return <span className="text-ds-muted">{formatAgo(app.created_at, c.now)}</span>;
    case "offer_type":
      return app.offer_type ? (
        <span className={`inline-flex items-center rounded-[6px] px-1.5 text-xs font-medium leading-5 ${app.offer_type === "unconditional" ? "bg-ds-good-soft text-ds-good" : "bg-ds-warn-soft text-ds-warn"}`}>
          {app.offer_type === "unconditional" ? "Unconditional" : "Conditional"}
        </span>
      ) : (
        <span className="text-ds-faint">—</span>
      );
    case "fee_paid":
      return app.application_fee_paid ? <span className="text-ds-good">Paid</span> : <span className="text-ds-faint">Not paid</span>;
    case "open_tasks":
      return <span className="tabular-nums text-ds-muted">{app.open_task_count ?? 0}</span>;
  }
}

function footerFor(key: ListColumnKey | "student", s: ListSummary | null): ReactNode {
  if (!s) return null;
  const v = (n: number | string) => <span className="font-medium text-ds-ink tabular-nums">{typeof n === "number" ? n.toLocaleString() : n}</span>;
  switch (key) {
    case "student":
      return <>{v(s.applications)} {plural(s.applications, "application", "applications")}</>;
    case "university":
      return <>{v(s.universities)} {plural(s.universities, "university", "universities")}</>;
    case "stage":
      return <>{v(s.stages)} {plural(s.stages, "stage", "stages")}</>;
    case "time_in_stage":
      return s.medianDaysInStage === null ? null : <>{v(`${s.medianDaysInStage}d`)} median</>;
    case "counsellor":
      return <>{v(s.counsellors)} {plural(s.counsellors, "counsellor", "counsellors")}</>;
    case "deadline":
      return <>{v(s.dueSoon)} due in 14d</>;
    default:
      return null;
  }
}

interface RowProps {
  app: Application;
  keys: ListColumnKey[];
  selected: boolean;
  anySelected: boolean;
  selectable: boolean;
  onToggle: (id: string) => void;
  href: string;
  cellCtx: CellCtx;
  hoveredRef: React.MutableRefObject<string | null>;
  focusedRef: React.MutableRefObject<string | null>;
}

const Row = memo(function Row({ app, keys, selected, anySelected, selectable, onToggle, href, cellCtx, hoveredRef, focusedRef }: RowProps) {
  const bg = selected ? "bg-ds-accent-soft" : "bg-ds-surface group-hover/row:bg-ds-hover";
  const name = studentName(app);
  return (
    <tr
      className="group/row h-9"
      data-testid="list-row"
      data-app-id={app.id}
      data-state={selected ? "selected" : undefined}
      onMouseEnter={() => {
        hoveredRef.current = app.id;
      }}
      onMouseLeave={() => {
        if (hoveredRef.current === app.id) hoveredRef.current = null;
      }}
      onFocusCapture={() => {
        focusedRef.current = app.id;
      }}
      onBlurCapture={() => {
        if (focusedRef.current === app.id) focusedRef.current = null;
      }}
    >
      <td className={`${CELL_BASE} sticky left-0 z-10 px-0 ${bg}`}>
        {selectable && (
          <span className={`flex h-full items-center justify-center transition-opacity ${anySelected || selected ? "opacity-100" : "opacity-55 group-hover/row:opacity-100 has-[:focus-visible]:opacity-100"}`}>
            <Checkbox className={CHECKBOX_CLASS} checked={selected} onCheckedChange={() => onToggle(app.id)} aria-label={`Select ${name}`} />
          </span>
        )}
      </td>
      <td style={{ left: CHECKBOX_WIDTH } as CSSProperties} className={`${CELL_BASE_NAME} ${bg} ${NAME_EDGE} sticky z-10 text-ds-ink`}>
        <div className={`${NAME_CLIP} relative flex items-center gap-2`}>
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#eef0f3] text-[9px] font-semibold text-ds-text">
            {initialsOf(name)}
          </span>
          <Link href={href} prefetch={false} className="min-w-0 truncate text-ds-ink underline-offset-[3px] group-hover/row:underline group-hover/row:decoration-ds-ghost">
            {name}
          </Link>
          <Link
            href={href}
            prefetch={false}
            tabIndex={-1}
            data-testid="row-open"
            className={`absolute right-0 hidden h-6 items-center gap-1 rounded-ds-sm bg-ds-surface px-2 text-xs font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] group-hover/row:flex`}
          >
            Open <span className="text-[11px] text-ds-faint">⌘↵</span>
          </Link>
        </div>
      </td>
      {keys.map((k) => (
        <td key={k} className={`${CELL_BASE} ${bg} text-ds-ink`}>
          {cellFor(k, app, cellCtx)}
        </td>
      ))}
    </tr>
  );
});

/** Phone age pill (the board card's `.age`): neutral has no fill. */
const PHONE_AGE_CLASS: Record<AgeTone, string> = {
  neutral: "text-[rgba(0,0,0,.63)]",
  amber: "bg-ds-warn-soft text-ds-warn",
  red: "bg-ds-bad-soft text-ds-bad",
};

/** "Deadline 2 Dec" / "Deadline in 9d" (≤14d, amber) / "Deadline passed" (red); null when unset. */
export function phoneDeadline(deadline: string | null, today: string): { text: string; tone: "past" | "soon" | "neutral" } | null {
  const tone = deadlineTone(deadline, today);
  if (tone === "none") return null;
  if (tone === "past") return { text: "Deadline passed", tone };
  if (tone === "soon") {
    const d = daysUntilDeadline(deadline, today) ?? 0;
    return { text: d === 0 ? "Deadline today" : `Deadline in ${d}d`, tone };
  }
  return { text: `Deadline ${formatDay(deadline)}`, tone };
}

function PhoneRow({ app, href, c }: { app: Application; href: string; c: CellCtx }) {
  const name = studentName(app);
  const st = c.stageById.get(app.placed_stage_id ?? app.stage_id);
  const days = daysInStage(app.stage_changed_at, c.now);
  const tone = ageTone(days, isFinishedStage(st));
  const dl = phoneDeadline(app.application_deadline, c.today);
  const who = resolveCounsellor(app, c.assigneeNames);
  const col = who ? colorFor(who.name) : null;
  return (
    <Link
      href={href}
      prefetch={false}
      data-testid="list-phone-row"
      data-app-id={app.id}
      className="-mx-4 flex min-h-[72px] flex-col justify-center gap-[3px] border-b border-ds-divider px-4 py-2.5 text-[13px] leading-[1.4] font-normal text-ds-text active:bg-ds-hover"
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ds-ink">{name}</span>
        <span data-testid="age-pill" data-tone={tone} className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[12px] font-medium tabular-nums ${PHONE_AGE_CLASS[tone]}`}>
          <ClockIcon className="size-3" />
          {days}d
        </span>
      </span>
      <span className="truncate text-ds-muted">
        {app.university_name}
        {app.program_name ? ` · ${app.program_name}` : ""}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ds-text">
        <span className="size-2 shrink-0 rounded-full" style={{ background: st?.color ?? "#9a9ea5" }} />
        <span className="shrink-0 whitespace-nowrap">{st?.name ?? "—"}</span>
        {dl && (
          <span data-testid="deadline" data-tone={dl.tone} className={`min-w-0 truncate ${dl.tone === "past" ? "text-ds-bad" : dl.tone === "soon" ? "text-ds-warn" : "text-ds-faint"}`}>
            · {dl.text}
          </span>
        )}
        <span className="ml-auto inline-flex min-w-0 shrink items-center gap-1.5 whitespace-nowrap pl-1 text-ds-muted">
          {who && col ? (
            <>
              <span className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-[9px] font-semibold" style={{ background: col.bg, color: col.fg }}>
                {who.initials}
              </span>
              <span className="truncate">{who.name}</span>
            </>
          ) : (
            <span className="text-[rgba(0,0,0,.42)]">Set counsellor</span>
          )}
        </span>
      </span>
    </Link>
  );
}

const PHONE_PAGER_BTN =
  "inline-flex size-8 items-center justify-center rounded-[8px] border border-ds-border bg-ds-surface text-ds-text disabled:opacity-45";

const BULK_BTN = "flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-medium text-[#e6e8ea] hover:bg-[#2c2f33] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 data-[state=open]:bg-[#2c2f33]";
const BULK_DIV = "mx-1 h-4 w-px bg-[#3b3f44]";
const UNASSIGN = "__none__";

export function ApplicationsList(p: ApplicationsListProps) {
  const router = useRouter();
  const fetchImpl = p.fetchImpl;
  const [data, setData] = useState<{ key: string; page: ListPage } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const [stagePick, setStagePick] = useState<{ app: Application; anchor: HTMLElement } | null>(null);
  const [bulkPick, setBulkPick] = useState<"stage" | "assign" | null>(null);
  const [busy, setBusy] = useState(false);
  const hoveredRef = useRef<string | null>(null);
  const focusedRef = useRef<string | null>(null);
  const justClosed = useRef<string | null>(null);

  const { stateQuery, page, pageSize, fetchPage, onLoaded, onPage } = p;
  const offset = (page - 1) * pageSize;
  const fetchKey = `${stateQuery}|${page}|${pageSize}`;

  // Changing page, page size, filter or sort clears the selection (state adjusted during render).
  const [selKey, setSelKey] = useState(fetchKey);
  if (selKey !== fetchKey) {
    setSelKey(fetchKey);
    setSelected(new Set());
  }

  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      setLoading(true);
      fetchPage(offset, pageSize)
        .then((res) => {
          if (!live) return;
          setData({ key: fetchKey, page: res });
          setFailed(false);
          setLoading(false);
          onLoaded?.({ total: res.total, truncated: res.truncated });
          // ?page= past the end (e.g. after a filter): go to the last real page.
          const win = pageWindow(page, pageSize, res.total);
          if (win.page !== page) onPage(win.page);
        })
        .catch(() => {
          if (!live) return;
          setFailed(true);
          setLoading(false);
        });
    }, 0);
    return () => {
      live = false;
      clearTimeout(id);
    };
    // reload re-runs the same key after a write
  }, [fetchKey, offset, pageSize, page, fetchPage, onLoaded, onPage, reload]);

  const current = data?.page ?? null;
  const rows = useMemo(() => current?.rows ?? [], [current]);
  const total = current?.total ?? 0;
  const win = pageWindow(page, pageSize, total);
  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const anySelected = selected.size > 0;

  const stageById = useMemo(() => new Map(p.stages.map((s) => [s.id, s])), [p.stages]);
  const activeStages = useMemo(() => p.stages.filter((s) => !isFinishedStage(s)), [p.stages]);
  const finishedStages = useMemo(() => p.stages.filter((s) => isFinishedStage(s)), [p.stages]);
  const [now] = useState(() => Date.now());
  const today = useMemo(() => ymdInTz(now, p.timezone), [now, p.timezone]);

  const openStagePicker = useCallback((app: Application, el: HTMLElement) => setStagePick({ app, anchor: el }), []);
  const cellCtx: CellCtx = useMemo(
    () => ({ stageById, assigneeNames: p.assigneeNames, today, now, canManage: p.canManageApplications, onStageCell: openStagePicker }),
    [stageById, p.assigneeNames, today, now, p.canManageApplications, openStagePicker],
  );

  const stageGroups = useCallback(
    (currentId: string | null): PickerGroup[] => {
      const item = (s: ApplicationStage) => ({
        value: s.id,
        label: s.name,
        checked: s.id === currentId,
        leading: <span className="size-2 shrink-0 rounded-full" style={{ background: s.color ?? "#9a9ea5" }} />,
      });
      const groups: PickerGroup[] = [{ items: activeStages.map(item) }];
      if (finishedStages.length) groups.push({ label: "Finished", items: finishedStages.map(item) });
      return groups;
    },
    [activeStages, finishedStages],
  );

  const counsellorGroups = useMemo((): PickerGroup[] => {
    const people = [...p.teamMembers].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    return [
      {
        items: [
          { value: UNASSIGN, label: "No assignee (use the student's)", leading: <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-ds-hover text-ds-faint"><UserIcon className="size-3" /></span> },
          ...people.map((m) => {
            const name = m.name || m.email.split("@")[0];
            const col = colorFor(name);
            return { value: m.user_id, label: name, leading: <Avatar initials={initialsOf(name)} bg={col.bg} fg={col.fg} /> };
          }),
        ],
      },
    ];
  }, [p.teamMembers]);

  // ── writes ───────────────────────────────────────────────────────────────────────────────────
  const afterWrite = useCallback(() => {
    setReload((n) => n + 1);
    p.onChanged();
  }, [p]);

  async function moveOne(app: Application, stageId: string) {
    setStagePick(null);
    if (stageId === (app.placed_stage_id ?? app.stage_id) && stageId === app.stage_id) return;
    setBusy(true);
    const res = await runBulkPatch([app.id], { stage_id: stageId }, fetchImpl);
    setBusy(false);
    const st = stageById.get(stageId);
    if (res.failed.length) toast.error("Couldn't move the application");
    else toast.success(`Moved to ${st?.name ?? "stage"}`);
    afterWrite();
  }

  async function bulk(body: Record<string, unknown>, verb: string) {
    setBulkPick(null);
    const ids = pageIds.filter((id) => selected.has(id));
    if (ids.length === 0) return;
    setBusy(true);
    const res = await runBulkPatch(ids, body, fetchImpl);
    setBusy(false);
    const t = bulkToast(res, verb);
    if (t.tone === "success") toast.success(t.text);
    else toast.error(t.text);
    // Failed rows stay selected so the user can retry.
    setSelected(new Set(res.failed));
    afterWrite();
  }

  // ⌘↵ / Ctrl+↵ opens the hovered or focused row.
  const detailHref = p.detailHref;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || isTypingTarget(e.target)) return;
      const id = hoveredRef.current ?? focusedRef.current;
      if (!id) return;
      e.preventDefault();
      router.push(detailHref(id));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, detailHref]);

  // ── header menu ─────────────────────────────────────────────────────────────────────────────────
  const keys = p.layout.keys as ListColumnKey[];
  const { field: sortField, dir: sortDir } = sortFieldOf(p.sort);
  const isSorted = (k: ListColumnKey) => LIST_COLUMNS[k].sortField === sortField;

  function closeMenu() {
    if (menu) {
      const key = menu.key;
      justClosed.current = key;
      setTimeout(() => {
        if (justClosed.current === key) justClosed.current = null;
      }, 250);
    }
    setMenu(null);
  }
  function openMenu(key: string, el: HTMLElement) {
    if (menu?.key === key) return closeMenu();
    if (justClosed.current === key) return;
    setMenu({ key, anchor: el });
  }

  const menuModel: ColumnMenuModel | null = (() => {
    if (!menu) return null;
    if (menu.key === "student") {
      return {
        key: "student", title: "Student", defaultTitle: "Student", isName: true, sortKey: undefined, activeSortDirection: null,
        canFilter: p.filterFieldKeys.has("student"), pinned: false, canPin: false, canMoveLeft: false, canMoveRight: false,
      };
    }
    const def = LIST_COLUMNS[menu.key as ListColumnKey];
    return {
      key: def.key,
      title: def.label,
      defaultTitle: def.label,
      isName: false,
      sortKey: def.sortField,
      activeSortDirection: def.sortField && def.sortField === sortField ? sortDir : null,
      canFilter: !!def.filterFieldKey && p.filterFieldKeys.has(def.filterFieldKey),
      pinned: false,
      canPin: false,
      canMoveLeft: canMove(p.layout, def.key, "left"),
      canMoveRight: canMove(p.layout, def.key, "right"),
    };
  })();

  const totalWidth = CHECKBOX_WIDTH + STUDENT_WIDTH + keys.reduce((n, k) => n + LIST_COLUMNS[k].width, 0);
  const summary = current?.summary ?? null;
  const showEmpty = !loading && !failed && current !== null && total === 0;
  const headState = headerCheckState(selected, pageIds);

  // Rendered only after mount (the workspace waits for the stored list prefs), so the synchronous
  // media read is hydration-safe and stops one frame of the table on a phone reload.
  if (p.phone || matchesBelowMd()) {
    return (
      <div className="relative flex flex-col" data-testid="applications-list" data-variant="phone">
        {showEmpty ? (
          <div className="flex flex-col items-center px-6 pt-14 pb-10 text-center" data-testid="list-no-matches">
            <div className="mb-3 flex size-10 items-center justify-center rounded-[12px] bg-ds-hover text-ds-faint">
              <MagnifyingGlassIcon className="size-4" />
            </div>
            <h3 className="mb-1 text-[15px] font-semibold text-ds-ink">{p.filtersActive ? "No applications match these filters" : "No applications yet"}</h3>
            <p className="mb-3.5 text-sm font-normal text-ds-muted">
              {p.filtersActive ? "Try removing a filter, or check the spelling of your search." : "Add an application to see it here."}
            </p>
            {p.filtersActive && (
              <button
                type="button"
                data-testid="list-clear-filters"
                onClick={p.onClearFilters}
                className="inline-flex h-8 items-center rounded-[8px] px-2.5 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)]"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="-mx-4 mt-2 border-t border-ds-border px-4" data-testid="list-phone-rows">
            {rows.length === 0
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={`sk-${i}`} aria-hidden className="-mx-4 flex h-[72px] flex-col justify-center gap-2 border-b border-ds-divider px-4">
                    <span className="block h-2.5 w-2/5 animate-pulse rounded-full bg-ds-hover" />
                    <span className="block h-2.5 w-3/5 animate-pulse rounded-full bg-ds-hover" />
                  </div>
                ))
              : rows.map((app) => <PhoneRow key={app.id} app={app} href={p.detailHref(app.id)} c={cellCtx} />)}
          </div>
        )}
        {total > 0 && (
          <div
            data-testid="list-phone-pager"
            className="sticky bottom-[-16px] z-10 -mx-4 mt-auto flex h-[52px] items-center gap-2 border-t border-ds-border bg-ds-surface px-4 text-[13px] text-ds-muted tabular-nums"
          >
            <span data-testid="list-showing">
              <b className="font-medium text-ds-ink">
                {(win.start + 1).toLocaleString()}–{win.end.toLocaleString()}
              </b>{" "}
              of {total.toLocaleString()}
              {current?.truncated ? "+" : ""}
            </span>
            <span className="flex-1" />
            <button type="button" aria-label="Previous page" disabled={win.page <= 1} onClick={() => p.onPage(win.page - 1)} className={PHONE_PAGER_BTN}>
              <CaretLeftIcon className="size-[15px]" />
            </button>
            <button type="button" aria-label="Next page" disabled={win.page >= win.totalPages} onClick={() => p.onPage(win.page + 1)} className={PHONE_PAGER_BTN}>
              <CaretRightIcon className="size-[15px]" />
            </button>
          </div>
        )}
        {failed && (
          <div role="alert" className="mx-auto mt-3 w-fit rounded-[8px] bg-ds-bad-soft px-3 py-1.5 text-sm text-ds-bad">
            Couldn&apos;t load applications.{" "}
            <button type="button" className="underline" onClick={() => setReload((n) => n + 1)}>
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="applications-list">
      {showEmpty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-auto border-t border-ds-border bg-ds-surface pt-16 pb-[72px] text-center" data-testid="list-no-matches">
          <div className="mb-3 flex size-10 items-center justify-center rounded-[12px] bg-ds-hover text-ds-faint">
            <MagnifyingGlassIcon className="size-4" />
          </div>
          <h3 className="mb-1 text-[15px] font-semibold text-ds-ink">{p.filtersActive ? "No applications match these filters" : "No applications yet"}</h3>
          <p className="mb-3.5 text-sm font-normal text-ds-muted">
            {p.filtersActive ? "Try removing a filter, or check the spelling of your search." : "Add an application to see it here."}
          </p>
          {p.filtersActive && (
            <button
              type="button"
              data-testid="list-clear-filters"
              onClick={p.onClearFilters}
              className="inline-flex h-7 items-center rounded-ds-sm px-2 text-sm font-medium text-ds-ink shadow-[inset_0_0_0_1px_var(--ds-border)] hover:bg-ds-hover"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div
          className="group/grid min-h-0 flex-1 overflow-auto border-t border-ds-border bg-ds-surface"
          data-testid="list-scroller"
          data-scrolled="false"
          onScroll={(e) => {
            const el = e.currentTarget;
            const next = String(el.scrollLeft > 0);
            if (el.dataset.scrolled !== next) el.dataset.scrolled = next;
          }}
        >
          <table className="border-separate border-spacing-0 text-sm font-medium" style={{ tableLayout: "fixed", width: "100%", minWidth: totalWidth }}>
            <colgroup>
              <col style={{ width: CHECKBOX_WIDTH }} />
              <col style={{ width: STUDENT_WIDTH }} />
              {keys.map((k) => (
                <col key={k} style={{ width: LIST_COLUMNS[k].width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={`${HEAD_BASE} sticky left-0 top-0 z-30`}>
                  {p.bulkAllowed && (
                    <span className="flex h-full items-center justify-center">
                      <Checkbox
                        className={CHECKBOX_CLASS}
                        checked={headState}
                        disabled={pageIds.length === 0}
                        onCheckedChange={() => setSelected((s) => togglePage(s, pageIds))}
                        aria-label="Select all on this page"
                      />
                    </span>
                  )}
                </th>
                <th scope="col" style={{ left: CHECKBOX_WIDTH }} className={`${HEAD_BASE} ${NAME_EDGE} sticky top-0 z-30`}>
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menu?.key === "student"}
                    data-testid="column-header-student"
                    onClick={(e) => openMenu("student", e.currentTarget.parentElement as HTMLElement)}
                    className="flex h-full w-full items-center gap-2 px-3 text-left font-medium text-ds-muted transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ds-ghost"
                  >
                    <span className="min-w-0 flex-1 truncate text-ds-ink">Student</span>
                  </button>
                </th>
                {keys.map((k) => {
                  const def = LIST_COLUMNS[k];
                  const IconC = LIST_COLUMN_ICONS[k];
                  const sorted = isSorted(k);
                  return (
                    <th
                      key={k}
                      scope="col"
                      aria-sort={sorted ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                      className={`${HEAD_BASE} group/th sticky top-0 z-20`}
                    >
                      <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={menu?.key === k}
                        data-testid={`column-header-${k}`}
                        onClick={(e) => openMenu(k, e.currentTarget.parentElement as HTMLElement)}
                        className="flex h-full w-full items-center gap-2 px-3 text-left font-medium text-ds-muted transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ds-ghost"
                      >
                        <IconC className="size-4 shrink-0 text-ds-faint" />
                        <span className="min-w-0 flex-1 truncate text-ds-ink">{def.label}</span>
                        {sorted ? (
                          sortDir === "asc" ? <ArrowUpIcon className="size-3.5 shrink-0 text-ds-muted" /> : <ArrowDownIcon className="size-3.5 shrink-0 text-ds-muted" />
                        ) : def.sortField ? (
                          <ArrowDownIcon className="size-3.5 shrink-0 text-ds-faint opacity-0 transition-opacity group-hover/th:opacity-100" />
                        ) : null}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 || (loading && data?.key !== fetchKey && rows.length === 0)
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="h-9" aria-hidden>
                      <td className={`${CELL_BASE} bg-ds-surface`} />
                      <td className={`${CELL_BASE} bg-ds-surface`}>
                        <span className="block h-2.5 w-3/5 animate-pulse rounded-full bg-ds-hover" />
                      </td>
                      {keys.map((k) => (
                        <td key={k} className={`${CELL_BASE} bg-ds-surface`}>
                          <span className="block h-2.5 w-3/5 animate-pulse rounded-full bg-ds-hover" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((app) => (
                    <Row
                      key={app.id}
                      app={app}
                      keys={keys}
                      selected={selected.has(app.id)}
                      anySelected={anySelected}
                      selectable={p.bulkAllowed}
                      onToggle={(id) => setSelected((s) => toggleId(s, id))}
                      href={p.detailHref(app.id)}
                      cellCtx={cellCtx}
                      hoveredRef={hoveredRef}
                      focusedRef={focusedRef}
                    />
                  ))}
            </tbody>
            <tfoot>
              <tr data-testid="list-footer">
                <td className="sticky bottom-0 left-0 z-30 h-9 border-t border-ds-border bg-ds-sunken p-0" />
                <td
                  style={{ left: CHECKBOX_WIDTH }}
                  data-testid="footer-student"
                  className={`sticky bottom-0 z-30 ${NAME_EDGE} h-9 border-t border-ds-border bg-ds-sunken px-3 text-[13px] font-medium text-ds-faint shadow-[inset_-1px_0_0_var(--ds-border)]`}
                >
                  <div className={NAME_CLIP}>{footerFor("student", summary)}</div>
                </td>
                {keys.map((k) => (
                  <td
                    key={k}
                    data-testid={`footer-${k}`}
                    className="sticky bottom-0 z-20 h-9 overflow-hidden whitespace-nowrap border-t border-ds-border bg-ds-sunken px-3 text-[13px] font-medium text-ds-faint shadow-[inset_-1px_0_0_var(--ds-border)]"
                  >
                    {footerFor(k, summary)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <GridPagination
        total={total}
        start={win.start}
        end={win.end}
        page={win.page}
        totalPages={win.totalPages}
        pageSize={pageSize}
        sizes={LIST_PAGE_SIZES}
        testId="list-showing"
        padLeft16
        onPage={p.onPage}
        onPageSize={p.onPageSize}
      />

      {failed && (
        <div role="alert" className="absolute inset-x-0 top-10 mx-auto w-fit rounded-ds-sm bg-ds-bad-soft px-3 py-1.5 text-sm text-ds-bad">
          Couldn&apos;t load applications.{" "}
          <button type="button" className="underline" onClick={() => setReload((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {p.bulkAllowed && anySelected && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          data-testid="list-bulk-bar"
          className="absolute bottom-16 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-[12px] bg-ds-ink p-1 text-white shadow-[0_0_0_1px_rgba(16,17,18,.06),0_8px_24px_-4px_rgba(16,17,18,.14),0_2px_6px_rgba(16,17,18,.06)]"
        >
          <span className="px-3 text-[13px] tabular-nums" aria-live="polite">
            {selected.size} selected
          </span>
          <span className={BULK_DIV} />
          <ListPicker
            open={bulkPick === "stage"}
            onOpenChange={(o) => setBulkPick(o ? "stage" : null)}
            trigger={
              <button type="button" data-bulk="stage" disabled={busy} className={BULK_BTN}>
                Move stage
              </button>
            }
            side="top"
            placeholder="Move to stage…"
            groups={stageGroups(null)}
            onPick={(stageId) => void bulk({ stage_id: stageId }, "moved")}
            testId="bulk-stage-picker"
          />
          <ListPicker
            open={bulkPick === "assign"}
            onOpenChange={(o) => setBulkPick(o ? "assign" : null)}
            trigger={
              <button type="button" data-bulk="assign" disabled={busy} className={BULK_BTN}>
                Assign counsellor
              </button>
            }
            side="top"
            width={280}
            placeholder="Assign counsellor…"
            groups={counsellorGroups}
            onPick={(v) => void bulk({ assigned_to: v === UNASSIGN ? null : v }, "updated")}
            testId="bulk-assign-picker"
          />
          <span className={BULK_DIV} />
          <button type="button" data-bulk="clear" className={BULK_BTN} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {stagePick && (
        <ListPicker
          open
          onOpenChange={(o) => !o && setStagePick(null)}
          anchor={stagePick.anchor}
          placeholder="Move to stage…"
          groups={stageGroups(stagePick.app.placed_stage_id ?? stagePick.app.stage_id)}
          onPick={(stageId) => void moveOne(stagePick.app, stageId)}
          testId="row-stage-picker"
        />
      )}

      {menu && menuModel && (
        <ColumnHeaderMenu
          key={menu.key}
          variant="compact"
          anchor={menu.anchor}
          model={menuModel}
          onClose={closeMenu}
          onSort={(field, dir) => p.onSort(SORT_BY_FIELD[field as ApplicationSortField][dir])}
          onFilter={() => {
            const fk = menu.key === "student" ? "student" : LIST_COLUMNS[menu.key as ListColumnKey].filterFieldKey;
            if (fk) p.onFilterRequest(fk);
          }}
          onTogglePin={() => {}}
          onMove={(dir) => p.onLayoutChange(moveColumn(p.layout, menu.key, dir))}
          onRename={() => {}}
          onHide={() => p.onLayoutChange(hideColumn(p.layout, menu.key))}
        />
      )}
    </div>
  );
}
