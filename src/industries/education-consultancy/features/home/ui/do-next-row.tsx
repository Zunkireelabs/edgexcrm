"use client";

import "./home.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowBendUpLeftIcon,
  CalendarBlankIcon,
  ChatCircleTextIcon,
  CheckIcon,
  ClockIcon,
  DotsThreeIcon,
  EnvelopeSimpleIcon,
  FileXIcon,
  HourglassIcon,
  ListChecksIcon,
  PhoneIcon,
  PhoneSlashIcon,
  PhoneXIcon,
  SnowflakeIcon,
  UserPlusIcon,
  WhatsappLogoIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { tenantLocalToIso } from "../lib/time";
import {
  OUTCOME_LABEL,
  planCallLogSave,
  runPlan,
  type CallOutcomeChoice,
  type PlannedRequest,
} from "../lib/call-log";
import type { DoNextItem } from "../lib/types";

export function KindIcon({ item }: { item: DoNextItem }) {
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
    case "missed_callbacks": return <PhoneXIcon {...c} />;
    case "unreachable": return <PhoneSlashIcon {...c} />;
  }
}

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

function RowAction({ item, onCall, onDone, onSheet, busy }: { item: DoNextItem; onCall: () => void; onDone: () => void; onSheet: () => void; busy: boolean }) {
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
    case "sheet":
      return (
        <Button look="v2" variant="secondary" size="sm" onClick={onSheet}>
          {a.label}
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


/** Row state shared by every list that shows Do-next rows (the counsellor Home and a manager's own to-dos). */
export function useDoNextRows() {
  const router = useRouter();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetKey, setSheetKey] = useState<string | null>(null);
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
  return { router, hidden, openLog, setOpenLog, busy, snooze, markDone, sheetKey, setSheetKey };
}
export type DoNextRows = ReturnType<typeof useDoNextRows>;

export function DoNextRow({ item, nextStage, tz, rows }: { item: DoNextItem; nextStage: { id: string; name: string } | null; tz: string; rows: DoNextRows }) {
  return (
    <div>
      <div className="eh-it">
        <span className={`eh-ic ${item.tone === "neutral" ? "" : item.tone}`}><KindIcon item={item} /></span>
        <div style={{ minWidth: 0 }}>
          <div className="eh-tl">
            {item.primaryAction.type === "sheet" ? (
              // A grouped row: its title opens the same sheet as its button (the exact leads it counted), never plain /leads.
              <button type="button" className="eh-nm eh-nm-btn" onClick={() => rows.setSheetKey(item.key)}>{item.title}</button>
            ) : (
              <Link href={item.evidenceHref} className="eh-nm">{item.title}</Link>
            )}
            <span className={`eh-chip ${item.chip.tone === "neutral" ? "" : item.chip.tone}`}>{item.chip.text}</span>
          </div>
          <div className="eh-wh"><span className="eh-ph">{item.chip.text}{item.why ? " \u00B7 " : ""}</span>{item.why}</div>
        </div>
        {/* "sheet" and "open" keep their words on a phone; the other actions shrink to an icon (.eh-lbl). */}
        <div className={item.primaryAction.type === "sheet" || item.primaryAction.type === "open" ? "eh-ac eh-ac-text" : "eh-ac"}>
          <RowAction item={item} busy={rows.busy === item.key} onCall={() => rows.setOpenLog(item.key)} onDone={() => rows.markDone(item)} onSheet={() => rows.setSheetKey(item.key)} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button look="v2" variant="ghost" size="icon" aria-label={`More actions for ${item.title}`}><DotsThreeIcon size={18} aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => rows.snooze(item)}>Snooze until tomorrow</DropdownMenuItem>
              {item.leadId ? <DropdownMenuItem asChild><Link href={`/leads/${item.leadId}`}>Open lead</Link></DropdownMenuItem> : null}
              {item.canMarkDone ? <DropdownMenuItem onSelect={() => rows.markDone(item)}>Mark done</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {rows.openLog === item.key && item.primaryAction.type === "call" ? (
        <CallLog item={item} nextStage={nextStage} tz={tz} onSaved={() => { rows.setOpenLog(null); rows.router.refresh(); }} />
      ) : null}
    </div>
  );
}

/**
 * "Call through them": the exact leads behind a grouped missed-call-backs row, as normal call rows (same row, same call
 * log), so the count in the row and the list here are the same set by construction.
 */
export function MissedCallbacksSheet({ item, nextStageByLead, tz, rows }: { item: DoNextItem; nextStageByLead: Record<string, { id: string; name: string } | null>; tz: string; rows: DoNextRows }) {
  const open = rows.sheetKey === item.key;
  const children = (item.children ?? []).filter((c) => !rows.hidden.has(c.key));
  return (
    <Sheet open={open} onOpenChange={(o) => rows.setSheetKey(o ? item.key : null)}>
      <SheetContent look="v2" size="md">
        <SheetHeader>
          <SheetTitle>{item.title}</SheetTitle>
          <SheetDescription>{item.chip.text}. Log each call and it drops off this list.</SheetDescription>
        </SheetHeader>
        <div className="eh" style={{ padding: "0 16px 24px", maxWidth: "none" }}>
          <div className="eh-list">
            {children.length === 0 ? <div className="eh-note" style={{ padding: "16px 14px" }}>All done.</div> : null}
            {children.map((c) => (
              <DoNextRow key={c.key} item={c} nextStage={c.primaryAction.type === "call" ? nextStageByLead[c.primaryAction.leadId] ?? null : null} tz={tz} rows={rows} />
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
