"use client";

import "./home.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowsClockwiseIcon, CopyIcon, PencilSimpleIcon, SparkleIcon, WhatsappLogoIcon, EnvelopeSimpleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { sendToLead } from "../lib/send-to-lead";
import type { DraftChannel, DraftTone } from "../lib/draft";
import type { DoNextItem } from "../lib/types";

interface DraftPayload {
  ai: boolean;
  paused?: boolean;
  leadId: string;
  leadName: string;
  channels: DraftChannel[];
  channel: DraftChannel | null;
  phone: string | null;
  email: { accountId: string; to: string } | null;
  recordsRead: string[];
  chips: { application: string; deadline: string | null; missing: string[] } | null;
  draft: { id: string | null; text: string; subject: string | null; why: string; followUp: { title: string; dueDate: string } } | null;
}

const CHANNEL_LABEL: Record<DraftChannel, string> = { whatsapp: "WhatsApp", email: "Email" };
const KIND_FOR_API = (i: DoNextItem) => i.kind;

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => null)) as { data?: T } | null;
    return { ok: res.ok, status: res.status, data: j?.data ?? null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/**
 * H3: Orca drafts a message in a side panel. A human edits and sends; nothing goes out on its own. It shows which records Orca read
 * and offers a follow-up task. WhatsApp is a hand-off ("Open in WhatsApp"), then "Did you send it?": only Yes logs it on the timeline.
 * All sending goes through sendToLead (lib/send-to-lead.ts), the one seam a real WhatsApp send will replace.
 */
/** Render with `key={item?.key}` so each row opens a fresh panel (all state resets). */
export function DraftPanel({ item, onClose, onSent }: { item: DoNextItem | null; onClose: () => void; onSent: () => void }) {
  const [data, setData] = useState<DraftPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [channel, setChannel] = useState<DraftChannel | null>(null);
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [editing, setEditing] = useState(false);
  const [addTask, setAddTask] = useState(true);
  const [awaiting, setAwaiting] = useState<{ url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolved = useRef(false);
  const draftId = useRef<string | null>(null);
  const reqId = useRef(0);
  const itemKey = item?.key ?? null;

  const apply = useCallback((d: DraftPayload) => {
    setData(d);
    setChannel(d.channel);
    setText(d.draft?.text ?? "");
    setSubject(d.draft?.subject ?? "");
    setPaused(!!d.paused);
    if (d.draft?.id) draftId.current = d.draft.id;
  }, []);

  const request = useCallback(
    async (tone: DraftTone, ch: DraftChannel | null, previous: string | null) => {
      if (!item?.leadId) return;
      const mine = ++reqId.current;
      setLoading(true);
      setError(null);
      const r = await postJson<DraftPayload>("/api/v1/home/draft", { leadId: item.leadId, kind: KIND_FOR_API(item), tone, channel: ch, previous, draftId: draftId.current });
      if (mine !== reqId.current) return;
      setLoading(false);
      if (!r.ok || !r.data?.ai) {
        setError(r.status === 404 ? "You can't open this lead." : "Orca couldn't draft this just now. Write your own below.");
        setData((d) => d ?? ({ ai: false, leadId: item.leadId as string, leadName: item.title, channels: [], channel: null, phone: null, email: null, recordsRead: [], chips: null, draft: null }));
        return;
      }
      apply(r.data);
    },
    [item, apply],
  );

  // The draft is written when the panel opens, not before (cost: nothing until the click). The panel starts in `loading`.
  useEffect(() => {
    if (!itemKey || !item?.leadId) return;
    let cancelled = false;
    void (async () => {
      const r = await postJson<DraftPayload>("/api/v1/home/draft", { leadId: item.leadId, kind: KIND_FOR_API(item), tone: "new", channel: null, previous: null, draftId: null });
      if (cancelled) return;
      setLoading(false);
      if (!r.ok || !r.data?.ai) {
        setError(r.status === 404 ? "You can't open this lead." : "Orca couldn't draft this just now. Write your own below.");
        setData({ ai: false, leadId: item.leadId as string, leadName: item.title, channels: [], channel: null, phone: null, email: null, recordsRead: [], chips: null, draft: null });
        return;
      }
      apply(r.data);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  const close = () => {
    // Closed without sending: record it (best effort; nothing else happens).
    if (draftId.current && !resolved.current) {
      void fetch("/api/v1/home/draft-resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId: draftId.current, action: "discarded" }), keepalive: true }).catch(() => {});
    }
    reqId.current++;
    onClose();
  };

  const finish = async (msg: string) => {
    resolved.current = true;
    if (addTask && data?.draft?.followUp && data.leadId) {
      const t = await postJson("/api/v1/my-tasks", { title: data.draft.followUp.title, due_date: data.draft.followUp.dueDate, lead_id: data.leadId });
      if (!t.ok) toast.error("Sent, but the follow-up task wasn't created", { duration: 10_000 });
    }
    toast.success(msg);
    onSent();
    onClose();
  };

  const send = async () => {
    if (!data || !channel) return;
    setBusy(true);
    setError(null);
    const r = await sendToLead(channel, { leadId: data.leadId, text, subject, phone: data.phone, email: data.email ? { fromAccountId: data.email.accountId, to: data.email.to } : undefined });
    setBusy(false);
    if (r.kind === "failed") return setError(r.message);
    if (r.kind === "handoff") {
      window.open(r.url, "_blank", "noopener");
      return setAwaiting({ url: r.url });
    }
    if (draftId.current) await postJson("/api/v1/home/draft-resolve", { draftId: draftId.current, action: "sent", channel, finalText: text });
    await finish("Email sent");
  };

  const answer = async (sent: boolean) => {
    setBusy(true);
    if (!draftId.current) { setBusy(false); return; }
    if (!sent) {
      // "No": nothing is logged on the timeline. The draft only records that WhatsApp was opened.
      await postJson("/api/v1/home/draft-resolve", { draftId: draftId.current, action: "opened", channel });
      setBusy(false);
      setAwaiting(null);
      return;
    }
    const r = await postJson("/api/v1/home/draft-resolve", { draftId: draftId.current, action: "sent", channel: "whatsapp", finalText: text });
    setBusy(false);
    if (!r.ok) return setError("Couldn't log it on the timeline. Try again.");
    await finish("Logged on the timeline");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const open = !!item;
  const chips = data?.chips;
  const sendLabel = channel === "whatsapp" ? "Open in WhatsApp" : channel === "email" ? "Send email" : "Copy";
  const tones: Array<[DraftTone, string]> = [["shorter", "Shorter"], ["formal", "More formal"], ["nepali", "In Nepali"]];

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <SheetContent look="v2" size="md">
        <SheetHeader>
          <SheetTitle><SparkleIcon size={16} aria-hidden /> Message to {data?.leadName ?? item?.title ?? ""}</SheetTitle>
          <SheetDescription className="sr-only">Orca&apos;s draft. Nothing is sent until you press the button.</SheetDescription>
          {chips ? (
            <div className="eh-dp-chips">
              <span className="eh-chip">{chips.application}</span>
              {chips.missing.length ? <span className="eh-chip">Missing: {chips.missing.join(", ")}</span> : null}
            </div>
          ) : null}
        </SheetHeader>
        <div className="eh-dp">
          {data && data.channels.length > 0 ? (
            <div className="eh-dp-tabs" role="group" aria-label="Channel">
              {data.channels.map((c) => (
                <button key={c} type="button" className="eh-opt" aria-pressed={channel === c} disabled={loading}
                  onClick={() => { if (c !== channel) { setChannel(c); void request("new", c, null); } }}>
                  {c === "whatsapp" ? <WhatsappLogoIcon size={14} aria-hidden /> : <EnvelopeSimpleIcon size={14} aria-hidden />}
                  {CHANNEL_LABEL[c]}
                </button>
              ))}
            </div>
          ) : null}

          {loading && !data?.draft ? (
            <div className="eh-orca-sk" aria-busy="true"><i /><i /><i /></div>
          ) : (
            <div className="eh-dp-draft">
              <div className="eh-dp-by"><SparkleIcon size={14} aria-hidden /> {data?.draft ? "Drafted by Orca" : "Write your own"}<span>{loading ? "writing..." : data?.draft ? "just now" : ""}</span></div>
              {channel === "email" ? <input className="eh-dp-subject" aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" /> : null}
              {editing || !data?.draft ? (
                <textarea aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your message" />
              ) : (
                <p className="eh-dp-text">{text}</p>
              )}
            </div>
          )}

          {data?.draft ? (
            <div className="eh-opts eh-dp-tone">
              <button type="button" className="eh-opt" aria-pressed={editing} onClick={() => setEditing((v) => !v)}><PencilSimpleIcon size={14} aria-hidden /> Edit</button>
              {tones.map(([t, label]) => <button key={t} type="button" className="eh-opt" disabled={loading} onClick={() => void request(t, channel, text)}>{label}</button>)}
              <button type="button" className="eh-opt" disabled={loading} onClick={() => void request("retry", channel, text)}><ArrowsClockwiseIcon size={14} aria-hidden /> Try again</button>
            </div>
          ) : null}

          {data?.draft ? (
            <p className="eh-dp-why"><b>Why this message:</b> {data.draft.why} Orca read {data.recordsRead.join(", ")}. Nothing else.</p>
          ) : null}
          {paused ? <p className="eh-dp-why">Orca is paused until tomorrow. You can still write your own.</p> : null}
          {data && !data.channel ? <p className="eh-dp-why">This lead has no WhatsApp number, and you have no Gmail connected for their address, so there is nothing to send from here. Copy the message and send it your own way.</p> : null}

          {data?.draft ? (
            <label className="eh-dp-task">
              <input type="checkbox" checked={addTask} onChange={(e) => setAddTask(e.target.checked)} />
              <span>Also add a task for me: {data.draft.followUp.title}</span>
            </label>
          ) : null}
          {error ? <div className="eh-err" role="alert">{error}</div> : null}
        </div>

        <div className="eh-dp-foot">
          {awaiting ? (
            <>
              <span className="eh-dp-q">Did you send it?</span>
              <Button look="v2" variant="secondary" size="sm" onClick={() => answer(false)} disabled={busy}>No</Button>
              <Button look="v2" variant="primary" size="sm" onClick={() => answer(true)} disabled={busy}>Yes, I sent it</Button>
            </>
          ) : (
            <>
              <span className="eh-dp-note">Nothing is sent until you press {channel ? "the button" : "Copy"}. {channel === "whatsapp" ? "WhatsApp opens in a new tab with the message ready." : channel === "email" ? "It&apos;s logged on the lead&apos;s timeline." : ""}</span>
              <Button look="v2" variant="secondary" size="sm" onClick={close}>Cancel</Button>
              {channel ? (
                <Button look="v2" variant="primary" size="sm" onClick={send} disabled={busy || loading || !text.trim()}>{sendLabel}</Button>
              ) : (
                <Button look="v2" variant="primary" size="sm" onClick={copy} disabled={!text.trim()}><CopyIcon size={14} aria-hidden /> Copy</Button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
