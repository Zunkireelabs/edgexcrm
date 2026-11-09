"use client";

import "./home.css";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PencilSimpleIcon, SparkleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { sendToLead } from "../lib/send-to-lead";
import { batchSummary, type BatchEntry } from "../lib/batch";
import type { DraftChannel } from "../lib/draft";

interface Card {
  leadId: string;
  leadName: string;
  kind: string;
  channels: DraftChannel[];
  channel: DraftChannel | null;
  phone: string | null;
  email: { accountId: string; to: string | null } | null;
  draft: { id: string | null; text: string; subject: string | null; why: string } | null;
  error?: "not_visible" | "no_channel";
}
type Status = { state: "sent" } | { state: "failed"; message: string };

const CH: Record<DraftChannel, string> = { whatsapp: "WhatsApp", email: "Email" };

async function post<T>(url: string, body: unknown): Promise<{ ok: boolean; data: T | null }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => null)) as { data?: T } | null;
    return { ok: res.ok, data: j?.data ?? null };
  } catch {
    return { ok: false, data: null };
  }
}

/**
 * H3b: every message drafted on one screen. Untick what you don't want, edit what you do, then send. Email goes out together on
 * "Send N". WhatsApp can't be sent from EdgeX yet, so "Go through N" opens each one in WhatsApp, asks "Sent?" on return, then moves on:
 * the counsellor never retypes, and only a Yes logs it. All sending goes through sendToLead. Render with `key` so each open is fresh.
 */
export function BatchPanel({ entries, open, onClose, onSent }: { entries: BatchEntry[]; open: boolean; onClose: () => void; onSent: () => void }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [walk, setWalk] = useState<{ queue: string[]; idx: number; phase: "ready" | "asking" } | null>(null);
  const [busy, setBusy] = useState(false);
  const sentAny = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const r = await post<{ ai: boolean; paused?: boolean; cards?: Card[] }>("/api/v1/home/draft-batch", { items: entries.map((e) => ({ leadId: e.leadId, kind: e.kind })) });
      if (cancelled) return;
      if (!r.ok || !r.data?.ai) return setFailed(true);
      if (r.data.paused) setPaused(true);
      const cs = r.data.cards ?? [];
      setCards(cs);
      setTicked(new Set(cs.filter((c) => c.draft && c.channel).map((c) => c.leadId)));
      setTexts(Object.fromEntries(cs.map((c) => [c.leadId, c.draft?.text ?? ""])));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const meta = new Map(entries.map((e) => [e.leadId, e]));
  const byId = new Map((cards ?? []).map((c) => [c.leadId, c]));
  const sendable = (cards ?? []).filter((c) => ticked.has(c.leadId) && c.channel && texts[c.leadId]?.trim() && status[c.leadId]?.state !== "sent");
  const emailCards = sendable.filter((c) => c.channel === "email");
  const waCards = sendable.filter((c) => c.channel === "whatsapp");

  const toggle = (id: string) => setTicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const markSent = (id: string) => { sentAny.current = true; setStatus((s) => ({ ...s, [id]: { state: "sent" } })); };
  const resolve = (c: Card, action: "sent" | "opened", channel: DraftChannel) =>
    c.draft?.id ? post("/api/v1/home/draft-resolve", { draftId: c.draft.id, action, channel, finalText: texts[c.leadId] }) : Promise.resolve({ ok: true, data: null });

  const sendEmails = async () => {
    setBusy(true);
    let ok = 0;
    for (const c of emailCards) {
      const r = await sendToLead("email", { leadId: c.leadId, text: texts[c.leadId], subject: c.draft?.subject ?? "Following up", email: c.email?.to ? { fromAccountId: c.email.accountId, to: c.email.to } : undefined });
      if (r.kind === "sent") {
        await resolve(c, "sent", "email");
        markSent(c.leadId);
        ok++;
      } else setStatus((s) => ({ ...s, [c.leadId]: { state: "failed", message: r.kind === "failed" ? r.message : "Couldn't send" } }));
    }
    setBusy(false);
    if (ok) { toast.success(`Sent ${ok} email${ok === 1 ? "" : "s"}`); onSent(); }
    if (ok < emailCards.length) toast.error(`${emailCards.length - ok} didn't send. They are marked on their cards.`, { duration: 10_000 });
  };

  const openWa = async (c: Card, queue: string[], idx: number) => {
    const r = await sendToLead("whatsapp", { leadId: c.leadId, text: texts[c.leadId], phone: c.phone });
    if (r.kind === "handoff") {
      window.open(r.url, "_blank", "noopener");
      setWalk({ queue, idx, phase: "asking" });
    } else {
      setStatus((s) => ({ ...s, [c.leadId]: { state: "failed", message: r.kind === "failed" ? r.message : "Couldn't open WhatsApp" } }));
      advance(queue, idx);
    }
  };
  const startWalk = () => {
    const queue = waCards.map((c) => c.leadId);
    if (queue.length) void openWa(byId.get(queue[0]) as Card, queue, 0);
  };
  const advance = (queue: string[], idx: number) => {
    if (idx + 1 >= queue.length) {
      setWalk(null);
      if (sentAny.current) onSent();
      return;
    }
    setWalk({ queue, idx: idx + 1, phase: "ready" });
  };
  const answer = async (yes: boolean) => {
    if (!walk) return;
    const c = byId.get(walk.queue[walk.idx]) as Card;
    setBusy(true);
    const r = await resolve(c, yes ? "sent" : "opened", "whatsapp"); // only Yes logs it on the timeline
    setBusy(false);
    if (yes && !r.ok) return toast.error("Couldn't log it on the timeline. Try again.");
    if (yes) markSent(c.leadId);
    advance(walk.queue, walk.idx);
  };

  const current = walk ? (byId.get(walk.queue[walk.idx]) ?? null) : null;
  const total = cards?.length ?? entries.length;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent look="v2" size="md">
        <SheetHeader>
          <SheetTitle><span className="eh-dp-title"><SparkleIcon size={16} aria-hidden /><span>Check before sending · {total} message{total === 1 ? "" : "s"}</span></span></SheetTitle>
          <SheetDescription className="sr-only">Orca drafted these. Nothing is sent until you press the button.</SheetDescription>
          <div className="eh-dp-chips">
            <span className="eh-chip">{batchSummary(entries)}</span>
            <span className="eh-chip">Each on the channel they last replied on</span>
          </div>
        </SheetHeader>
        <div className="eh-dp">
          {failed ? <p className="eh-dp-why">Couldn&apos;t prepare these just now. You can still use each row&apos;s own Draft button.</p> : null}
          {paused ? <p className="eh-dp-why">Orca is paused until tomorrow.</p> : null}
          {!cards && !failed ? <div className="eh-orca-sk" aria-busy="true"><i /><i /><i /></div> : null}
          {(cards ?? []).map((c) => {
            const m = meta.get(c.leadId);
            const st = status[c.leadId];
            const isEditing = editing.has(c.leadId) || !c.draft;
            return (
              <div key={c.leadId} className="eh-bp-card" data-state={st?.state}>
                <div className="eh-bp-top">
                  <label className="eh-bp-name">
                    <input type="checkbox" checked={ticked.has(c.leadId)} disabled={!c.channel || st?.state === "sent"} onChange={() => toggle(c.leadId)} aria-label={`Include ${c.leadName || m?.name}`} />
                    <b>{c.leadName || m?.name}</b>
                  </label>
                  <span className="eh-chip">{c.channel ? CH[c.channel] : "No channel"}{m ? ` · ${m.label}` : ""}</span>
                  {c.draft && st?.state !== "sent" ? (
                    <button type="button" className="eh-bp-edit" onClick={() => setEditing((s) => { const n = new Set(s); if (n.has(c.leadId)) n.delete(c.leadId); else n.add(c.leadId); return n; })}>
                      <PencilSimpleIcon size={14} aria-hidden /> Edit
                    </button>
                  ) : null}
                </div>
                {st?.state === "sent" ? <p className="eh-dp-why">Sent{c.channel === "whatsapp" ? " from your phone and logged on the timeline" : " and logged on the timeline"}.</p> : null}
                {st?.state === "failed" ? <div className="eh-err" role="alert">{st.message}</div> : null}
                {c.error === "no_channel" ? <p className="eh-dp-why">No WhatsApp number, and no Gmail for their address: nothing to send from here.</p> : null}
                {c.error === "not_visible" ? <p className="eh-dp-why">You can&apos;t open this lead.</p> : null}
                {!c.draft && !c.error ? <p className="eh-dp-why">Couldn&apos;t draft, write your own.</p> : null}
                {st?.state !== "sent" && c.channel ? (
                  isEditing ? (
                    <textarea aria-label={`Message to ${c.leadName}`} value={texts[c.leadId] ?? ""} onChange={(e) => setTexts((t) => ({ ...t, [c.leadId]: e.target.value }))} placeholder="Write your message" />
                  ) : (
                    <p className="eh-dp-text">{texts[c.leadId]}</p>
                  )
                ) : null}
              </div>
            );
          })}
          {cards ? <p className="eh-dp-why">Each draft uses that lead&apos;s last notes and messages. Unticked ones are not sent; you can open them later from their row for 24 hours.</p> : null}
        </div>
        <div className="eh-dp-foot">
          {walk && current ? (
            walk.phase === "asking" ? (
              <>
                <span className="eh-dp-q">Sent? {current.leadName} ({walk.idx + 1} of {walk.queue.length})</span>
                <Button look="v2" variant="secondary" size="sm" onClick={() => answer(false)} disabled={busy}>No</Button>
                <Button look="v2" variant="primary" size="sm" onClick={() => answer(true)} disabled={busy}>Yes, I sent it</Button>
              </>
            ) : (
              <>
                <span className="eh-dp-q">Next: {current.leadName} ({walk.idx + 1} of {walk.queue.length})</span>
                <Button look="v2" variant="secondary" size="sm" onClick={() => { setWalk(null); if (sentAny.current) onSent(); }}>Stop</Button>
                <Button look="v2" variant="primary" size="sm" onClick={() => void openWa(current, walk.queue, walk.idx)}>Open in WhatsApp</Button>
              </>
            )
          ) : (
            <>
              <span className="eh-dp-note">Each message is logged on the lead&apos;s timeline. WhatsApp ones open in WhatsApp one at a time.</span>
              <Button look="v2" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
              {emailCards.length > 0 ? <Button look="v2" variant="primary" size="sm" onClick={sendEmails} disabled={busy}>Send {emailCards.length}</Button> : null}
              {waCards.length > 0 ? <Button look="v2" variant={emailCards.length ? "secondary" : "primary"} size="sm" onClick={startWalk} disabled={busy}>Go through {waCards.length}</Button> : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
