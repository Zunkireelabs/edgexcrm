"use client";

import "./home.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  SparkleIcon,
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

interface AiProposal { field: string; label: string; from: string; to: string; quote: string }
interface AiState { status: "idle" | "loading" | "done"; draftId: string | null; proposals: AiProposal[]; nextKind: "call_back" | "office_visit" | "none" }
const AI_IDLE: AiState = { status: "idle", draftId: null, proposals: [], nextKind: "none" };
const NOTE_IDLE_MS = 1500;
const NOTE_MIN_CHARS = 8;

/** An instant as the `datetime-local` value in the tenant's zone (the inverse of tenantLocalToIso). */
function isoToTenantLocal(iso: string, tz: string): string {
  return new Date(iso).toLocaleString("sv-SE", { timeZone: tz }).slice(0, 16).replace(" ", "T");
}

/**
 * The inline call log (H4). Writes through the existing endpoints, in a fixed order (see call-log.ts). With AI on, after
 * "Talked" the note box reads the note and ticks the record fields Orca found; Save writes the note, the ticked fields, the
 * stage move and the call-back. With AI off or failing it is exactly the two-click version.
 */
function CallLog({ item, nextStage, tz, aiNote, onSaved }: { item: DoNextItem; nextStage: { id: string; name: string } | null; tz: string; aiNote: boolean; onSaved: () => void }) {
  const [outcome, setOutcome] = useState<CallOutcomeChoice>("talked");
  const [wantCallback, setWantCallback] = useState(false);
  const [callbackAt, setCallbackAt] = useState("");
  const [moveNext, setMoveNext] = useState(false);
  const [wantNote, setWantNote] = useState(false);
  const [note, setNote] = useState("");
  const [officeVisit, setOfficeVisit] = useState(false);
  const [ai, setAi] = useState<AiState>(AI_IDLE);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const lastRead = useRef("");
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiBox = aiNote && outcome === "talked";
  const leadId = item.primaryAction.type === "call" ? item.primaryAction.leadId : "";

  const readNote = async (text: string) => {
    const t = text.trim();
    if (!aiBox || t.length < NOTE_MIN_CHARS || t === lastRead.current) return;
    lastRead.current = t;
    const mine = ++reqId.current;
    setAi({ ...AI_IDLE, status: "loading" });
    try {
      const res = await fetch("/api/v1/home/note-extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId, note: t, nextStageName: nextStage?.name ?? null }) });
      const j = (await res.json().catch(() => null)) as { data?: { ai: boolean; draftId?: string | null; proposals?: AiProposal[]; callbackAt?: string | null; nextKind?: AiState["nextKind"] } } | null;
      if (mine !== reqId.current) return; // the note changed, or Save ran: this answer is stale
      const d = j?.data;
      if (!res.ok || !d?.ai) return setAi(AI_IDLE);
      const proposals = d.proposals ?? [];
      setAi({ status: "done", draftId: d.draftId ?? null, proposals, nextKind: d.nextKind ?? "none" });
      setTicked(new Set(proposals.map((p) => p.field)));
      setMoveNext(proposals.some((p) => p.field === "stage"));
      if (d.callbackAt) {
        setWantCallback(true);
        setCallbackAt(isoToTenantLocal(d.callbackAt, tz));
      }
      setOfficeVisit(d.nextKind === "office_visit");
    } catch {
      if (mine === reqId.current) setAi(AI_IDLE);
    }
  };
  useEffect(() => () => { if (idle.current) clearTimeout(idle.current); }, []);
  const onNoteChange = (v: string) => {
    setNote(v);
    if (idle.current) clearTimeout(idle.current);
    if (aiBox) idle.current = setTimeout(() => void readNote(v), NOTE_IDLE_MS);
  };

  const toggleTick = (field: string) => {
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
    if (field === "stage") setMoveNext((v) => !v);
  };

  const save = async () => {
    setError(null);
    if (wantCallback && !callbackAt) return setError("Pick a date and time for the call-back.");
    const callbackIso = wantCallback ? tenantLocalToIso(callbackAt, tz) : null;
    if (wantCallback && !callbackIso) return setError("That date and time isn't valid.");
    reqId.current++; // an answer still on its way is stale from here
    if (idle.current) clearTimeout(idle.current);
    setSaving(true);
    const noteText = aiBox || wantNote ? note.trim() : "";
    const fields = ai.status === "done" ? ai.proposals.filter((p) => p.field !== "stage" && ticked.has(p.field)).map((p) => ({ field: p.field, to: p.to })) : [];
    const plan = planCallLogSave({
      leadId,
      outcome,
      callbackAt: callbackIso,
      nextListId: moveNext && nextStage ? nextStage.id : null,
      note: officeVisit && aiBox ? `${noteText}${noteText ? "\n\n" : ""}Next step: office visit.` : noteText,
      ai: fields.length ? { draftId: ai.draftId, fields } : undefined,
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

  if (item.primaryAction.type !== "call") return null;
  const { leadName } = item.primaryAction;
  const shown = ai.status === "done" ? ai.proposals : [];

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
      {aiBox ? (
        <>
          <div className="q">Your note (type it the way you&apos;d say it)</div>
          <textarea aria-label="Your note" value={note} onChange={(e) => onNoteChange(e.target.value)} onBlur={() => { if (idle.current) clearTimeout(idle.current); void readNote(note); }} placeholder="Planning UK, +2 in 2020, IELTS in December, father pays, call back Wednesday morning" />
          {ai.status === "loading" ? <div className="eh-ai-note" aria-live="polite">Orca is reading your note...</div> : null}
          {shown.length > 0 ? (
            <div className="eh-ai" role="group" aria-label="Orca's suggestions">
              <div className="eh-ai-h"><SparkleIcon size={14} aria-hidden /> Orca filled in {leadName.split(" ")[0]}&apos;s record from your note <span>untick anything wrong</span></div>
              {shown.map((p) => (
                <label key={p.field} className="eh-ai-row">
                  <input type="checkbox" checked={ticked.has(p.field)} onChange={() => toggleTick(p.field)} />
                  <span className="k">{p.label}</span>
                  <span className="v">
                    {p.from ? <><s>{p.from}</s> {"\u2192"} </> : null}
                    <b>{p.to}</b>
                  </span>
                  <span className="qt">&ldquo;{p.quote}&rdquo;</span>
                </label>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
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
        {aiBox ? (
          <button type="button" className="eh-opt" aria-pressed={officeVisit} onClick={() => setOfficeVisit((v) => !v)}>
            Book an office visit
          </button>
        ) : null}
        {nextStage ? (
          <button type="button" className="eh-opt" aria-pressed={moveNext} onClick={() => { setMoveNext((v) => !v); if (shown.some((p) => p.field === "stage")) toggleTick("stage"); }}>
            Move to {nextStage.name}
          </button>
        ) : null}
        {aiBox ? null : (
          <button type="button" className="eh-opt" aria-pressed={wantNote} onClick={() => setWantNote((v) => !v)}>
            Add a note
          </button>
        )}
        <span style={{ marginLeft: "auto" }}>
          <Button look="v2" variant="primary" size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving" : "Save"}
          </Button>
        </span>
      </div>
      {!aiBox && wantNote ? <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was said?" /> : null}
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
export function useDoNextRows(opts: { aiNote?: boolean } = {}) {
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
  return { router, hidden, openLog, setOpenLog, busy, snooze, markDone, sheetKey, setSheetKey, aiNote: opts.aiNote === true };
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
        <CallLog item={item} nextStage={nextStage} tz={tz} aiNote={rows.aiNote} onSaved={() => { rows.setOpenLog(null); rows.router.refresh(); }} />
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
