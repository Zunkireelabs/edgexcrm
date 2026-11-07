"use client";

import "./home.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowBendUpLeftIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  ChatCircleTextIcon,
  CheckIcon,
  ClockIcon,
  DotsThreeIcon,
  EnvelopeSimpleIcon,
  FileXIcon,
  HourglassIcon,
  ListChecksIcon,
  PhoneIcon,
  PhoneXIcon,
  PulseIcon,
  SealCheckIcon,
  SnowflakeIcon,
  UserPlusIcon,
  WhatsappLogoIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { filterItems } from "../lib/build";
import { VISIBLE_LIMIT } from "../lib/rank";
import { tenantLocalToIso } from "../lib/time";
import {
  OUTCOME_LABEL,
  planCallLogSave,
  runPlan,
  type CallOutcomeChoice,
  type PlannedRequest,
} from "../lib/call-log";
import type { DoNextFilter, DoNextItem, DoNextTier } from "../lib/types";
import type { HomeData } from "../server/load-page";

const TIERS: Array<{ tier: DoNextTier; title: string; desc: string }> = [
  { tier: "now", title: "Now", desc: "new leads, replies waiting, anything overdue" },
  { tier: "today", title: "Today", desc: "booked call-backs, deadlines this week, tasks due" },
  { tier: "week", title: "This week", desc: "leads going quiet, files stuck in a stage" },
];

function KindIcon({ item }: { item: DoNextItem }) {
  const c = { size: 18, "aria-hidden": true } as const;
  switch (item.kind) {
    case "new_uncalled": return <UserPlusIcon {...c} />;
    case "reply_waiting": return item.provider === "whatsapp" ? <WhatsappLogoIcon {...c} /> : <EnvelopeSimpleIcon {...c} />;
    case "callback_overdue": return <PhoneXIcon {...c} />;
    case "callback_today": return <ClockIcon {...c} />;
    case "deadline_docs": return <FileXIcon {...c} />;
    case "task_due": return <ListChecksIcon {...c} />;
    case "going_quiet": return <SnowflakeIcon {...c} />;
    case "stuck_in_stage": return <HourglassIcon {...c} />;
  }
}

const FILTER_LABELS: Array<[DoNextFilter, string]> = [
  ["all", "All"],
  ["calls", "Calls"],
  ["messages", "Messages"],
  ["documents", "Documents"],
  ["tasks", "Tasks"],
];

async function send(req: PlannedRequest) {
  try {
    const res = await fetch(req.url, { method: req.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => null)) as { error?: { message?: string; details?: Record<string, string[]> } } | null;
    const detail = j?.error?.details ? Object.values(j.error.details).flat()[0] : undefined;
    return { ok: false, message: detail ?? j?.error?.message ?? `Request failed (${res.status})` };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

/** The inline call log (H4 without the note box). Writes through the existing endpoints, in a fixed order (see call-log.ts). */
function CallLog({ item, nextStage, tz, onSaved }: { item: DoNextItem; nextStage: { id: string; name: string } | null; tz: string; onSaved: () => void }) {
  const [outcome, setOutcome] = useState<CallOutcomeChoice>("talked");
  const [wantCallback, setWantCallback] = useState(false);
  const [callbackAt, setCallbackAt] = useState("");
  const [moveNext, setMoveNext] = useState(false);
  const [wantNote, setWantNote] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (item.primaryAction.type !== "call") return null;
  const { leadId, leadName } = item.primaryAction;

  const save = async () => {
    setError(null);
    if (wantCallback && !callbackAt) return setError("Pick a date and time for the call-back.");
    const callbackIso = wantCallback ? tenantLocalToIso(callbackAt, tz) : null;
    if (wantCallback && !callbackIso) return setError("That date and time isn't valid.");
    setSaving(true);
    const plan = planCallLogSave({
      leadId,
      outcome,
      callbackAt: callbackIso,
      nextListId: moveNext && nextStage ? nextStage.id : null,
      note: wantNote ? note : "",
    });
    const r = await runPlan(plan, send);
    setSaving(false);
    if (!r.ok) {
      setError(r.done.length ? `Saved the call, but the ${r.failed === "lead" ? "next step" : r.failed} failed: ${r.message}` : r.message);
      if (r.done.length) onSaved();
      return;
    }
    toast.success("Call logged");
    onSaved();
  };

  return (
    <div className="eh-log">
      <div className="q">How did the call with {leadName} go?</div>
      <div className="eh-opts" role="group" aria-label="Call outcome">
        {(Object.keys(OUTCOME_LABEL) as CallOutcomeChoice[]).map((k) => (
          <button key={k} type="button" className="eh-opt" aria-pressed={outcome === k} onClick={() => setOutcome(k)}>
            {k === "talked" ? <PhoneIcon size={14} aria-hidden /> : null}
            {OUTCOME_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="q">Next step</div>
      <div className="eh-opts">
        <button type="button" className="eh-opt" aria-pressed={wantCallback} onClick={() => setWantCallback((v) => !v)}>
          <CalendarBlankIcon size={14} aria-hidden /> Call back
        </button>
        {wantCallback ? (
          <>
            <input type="datetime-local" aria-label="Call-back date and time" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} />
            <span className="eh-wh" style={{ margin: 0 }}>{tz.replace(/^.*\//, "").replace(/_/g, " ")} time</span>
          </>
        ) : null}
        {nextStage ? (
          <button type="button" className="eh-opt" aria-pressed={moveNext} onClick={() => setMoveNext((v) => !v)}>
            Move to {nextStage.name}
          </button>
        ) : null}
        <button type="button" className="eh-opt" aria-pressed={wantNote} onClick={() => setWantNote((v) => !v)}>
          Add a note
        </button>
        <span style={{ marginLeft: "auto" }}>
          <Button look="v2" variant="primary" size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving" : "Save"}
          </Button>
        </span>
      </div>
      {wantNote ? <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was said?" /> : null}
      {error ? <div className="eh-err" role="alert">{error}</div> : null}
    </div>
  );
}

function RowAction({ item, onCall, onDone, busy }: { item: DoNextItem; onCall: () => void; onDone: () => void; busy: boolean }) {
  const a = item.primaryAction;
  const lbl = (t: string) => <span className="eh-lbl">{t}</span>;
  switch (a.type) {
    case "call":
      return (
        <Button look="v2" variant="secondary" size="sm" asChild>
          <a href={a.phone ? `tel:${a.phone}` : undefined} onClick={onCall} aria-label={`Call ${a.leadName}`}>
            <PhoneIcon size={14} aria-hidden />
            {lbl("Call")}
          </a>
        </Button>
      );
    case "reply":
      return (
        <Button look="v2" variant="secondary" size="sm" asChild>
          <Link href={a.href} aria-label="Reply">
            <ArrowBendUpLeftIcon size={14} aria-hidden />
            {lbl("Reply")}
          </Link>
        </Button>
      );
    case "ask_docs":
      return (
        <Button look="v2" variant="secondary" size="sm" asChild>
          <Link href={a.href} aria-label="Ask for the document">
            <ChatCircleTextIcon size={14} aria-hidden />
            {lbl("Ask for it")}
          </Link>
        </Button>
      );
    case "done_task":
      return (
        <Button look="v2" variant="secondary" size="sm" onClick={onDone} disabled={busy} aria-label="Mark done">
          <CheckIcon size={14} aria-hidden />
          {lbl("Done")}
        </Button>
      );
    case "open":
      return (
        <Button look="v2" variant="secondary" size="sm" asChild>
          <Link href={a.href}>{a.label}</Link>
        </Button>
      );
  }
}

export function EducationHome({ data }: { data: HomeData }) {
  const router = useRouter();
  const [filter, setFilter] = useState<DoNextFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const visibleAll = data.doNext.items.filter((i) => !hidden.has(i.key));
  const filtered = filterItems(visibleAll, filter);
  const shown = showAll ? filtered : filtered.slice(0, VISIBLE_LIMIT);
  const hiddenCount = filtered.length - shown.length;
  const hide = (key: string) => setHidden((s) => new Set(s).add(key));

  const snooze = async (item: DoNextItem) => {
    const res = await fetch("/api/v1/home/snooze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_key: item.key }) });
    if (!res.ok) return toast.error("Couldn't snooze that");
    hide(item.key);
    toast.success("Back tomorrow morning");
  };
  const markDone = async (item: DoNextItem) => {
    if (item.primaryAction.type !== "done_task") return;
    setBusy(item.key);
    const res = await fetch(`/api/v1/my-tasks/${item.primaryAction.taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }) });
    setBusy(null);
    if (!res.ok) return toast.error("Couldn't mark that done");
    hide(item.key);
    router.refresh();
  };

  const counts = {
    all: visibleAll.length,
    calls: filterItems(visibleAll, "calls").length,
    messages: filterItems(visibleAll, "messages").length,
    documents: filterItems(visibleAll, "documents").length,
    tasks: filterItems(visibleAll, "tasks").length,
  };
  const segItems = FILTER_LABELS.filter(([k]) => k === "all" || counts[k] > 0).map(([k, label]) => ({ value: k, label, count: counts[k] }));
  const activeFilter = segItems.some((s) => s.value === filter) ? filter : "all";

  return (
    <div className="eh">
      <h1 className="eh-h1">{data.greeting}</h1>
      <p className="eh-lede">
        {data.lede}
        {data.nextUp ? <span className="eh-nextup"> · {data.nextUp}</span> : null}
      </p>
      <div className="eh-cols">
        <section aria-label="Do next">
          <div className="eh-sh">
            <h2>Do next</h2>
            <span className="eh-count">{counts.all}</span>
            {counts.all > 0 ? (
              <span className="eh-seg">
                <SegmentedControl aria-label="Filter Do next" value={activeFilter} onValueChange={(v) => { setFilter(v as DoNextFilter); setShowAll(false); }} items={segItems} />
              </span>
            ) : null}
          </div>
          {counts.all === 0 ? (
            <div className="eh-list eh-empty">
              <div className="badge"><SealCheckIcon size={22} aria-hidden /></div>
              <div className="t">You&apos;re on top of everything</div>
              <div className="s">
                {data.agenda.find((e) => e.time)
                  ? <>Next up: <b style={{ color: "var(--ds-ink)", fontWeight: 500 }}>{data.agenda.find((e) => e.time)!.title} at {data.agenda.find((e) => e.time)!.time}</b>.</>
                  : "Nothing needs you right now."}
              </div>
              <div className="b">
                <Button look="v2" variant="secondary" size="sm" asChild><Link href="/leads">Open my leads</Link></Button>
              </div>
            </div>
          ) : (
            TIERS.map(({ tier, title, desc }) => {
              const rows = shown.filter((i) => i.tier === tier);
              if (rows.length === 0) return null;
              const isLastTier = tier === [...TIERS].reverse().find((t) => shown.some((i) => i.tier === t.tier))?.tier;
              return (
                <div key={tier}>
                  <div className="eh-tier"><span className="t">{title}</span><span className="d">{desc}</span></div>
                  <div className="eh-list">
                    {rows.map((item) => (
                      <div key={item.key}>
                        <div className="eh-it">
                          <span className={`eh-ic ${item.tone === "neutral" ? "" : item.tone}`}><KindIcon item={item} /></span>
                          <div style={{ minWidth: 0 }}>
                            <div className="eh-tl">
                              <Link href={item.evidenceHref} className="eh-nm">{item.title}</Link>
                              <span className={`eh-chip ${item.chip.tone === "neutral" ? "" : item.chip.tone}`}>{item.chip.text}</span>
                            </div>
                            <div className="eh-wh"><span className="eh-ph">{item.chip.text}{item.why ? " · " : ""}</span>{item.why}</div>
                          </div>
                          <div className="eh-ac">
                            <RowAction item={item} busy={busy === item.key} onCall={() => setOpenLog(item.key)} onDone={() => markDone(item)} />
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button look="v2" variant="ghost" size="icon" aria-label={`More actions for ${item.title}`}><DotsThreeIcon size={18} aria-hidden /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => snooze(item)}>Snooze until tomorrow</DropdownMenuItem>
                                {item.leadId ? <DropdownMenuItem asChild><Link href={`/leads/${item.leadId}`}>Open lead</Link></DropdownMenuItem> : null}
                                {item.canMarkDone ? <DropdownMenuItem onSelect={() => markDone(item)}>Mark done</DropdownMenuItem> : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                        {openLog === item.key && item.primaryAction.type === "call" ? (
                          <CallLog
                            item={item}
                            nextStage={data.nextStageByLead[item.primaryAction.leadId] ?? null}
                            tz={data.tz}
                            onSaved={() => { setOpenLog(null); router.refresh(); }}
                          />
                        ) : null}
                      </div>
                    ))}
                    {isLastTier && hiddenCount > 0 ? (
                      <button type="button" className="eh-more" onClick={() => setShowAll(true)}>
                        Show {hiddenCount} more <CaretDownIcon size={14} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </section>

        <aside className="eh-side" aria-label="Today and your last 7 days">
          <div className="eh-card">
            <div className="eh-ch"><CalendarBlankIcon size={16} aria-hidden /><h3>Today</h3><span className="r" style={{ color: "var(--ds-accent)" }}>{data.dateShort}</span></div>
            {data.agenda.length === 0 ? <div className="eh-wh" style={{ padding: "6px 0 8px" }}>Nothing booked for today.</div> : null}
            {data.agenda.map((e, i) => (
              <div key={`${e.title}-${i}`} className={`eh-ag${e.soon ? " soon" : ""}`}>
                <span className={`tm${e.time ? "" : " no"}`}>{e.time ?? "today"}</span>
                <div className="x">{e.title}{e.sub ? <span>{e.sub}</span> : null}</div>
              </div>
            ))}
          </div>
          {data.week.length > 0 ? (
            <div className="eh-card">
              <div className="eh-ch"><PulseIcon size={16} aria-hidden /><h3>Your last 7 days</h3></div>
              {data.week.map((m) => (
                <div key={m.key} className="eh-met">
                  <span className="k">{m.label}</span>
                  <span className="v">{m.value}</span>
                  {m.note ? <span className={`u ${m.tone === "neutral" ? "" : m.tone}`}>{m.note}</span> : null}
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

