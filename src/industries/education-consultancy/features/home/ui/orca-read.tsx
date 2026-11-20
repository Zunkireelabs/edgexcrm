"use client";

import "./home.css";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowsClockwiseIcon, ArrowUpIcon, SparkleIcon, ThumbsDownIcon, ThumbsUpIcon } from "@/components/icons";
import { useAIAssistant } from "@/contexts/ai-assistant-context";
import { ASK_CHIPS, madeAtLabel, refreshesLeft, type ReadScope } from "../lib/orca-read";
import type { StoredRead } from "../server/stored-read";

type Post = { ai: boolean; paused?: boolean; read?: StoredRead | null };

async function post(body: Record<string, unknown>): Promise<{ status: number; data: Post | null }> {
  try {
    const res = await fetch("/api/v1/home/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => null)) as { data?: Post } | null;
    return { status: res.status, data: j?.data ?? null };
  } catch {
    return { status: 0, data: null };
  }
}

/**
 * Orca's read (H1 for a counsellor, H5 for an owner / manager): up to 3 points, each a claim, a reason and a link built by our
 * code from the ids. Home renders at once: with no read made yet the card shows a 3-line skeleton, then fills. With AI off or
 * failing the card never appears (the parent only renders it when AI is on, and a failed read hides it).
 */
export function OrcaReadCard({ scope, initial, tz, title, canAsk }: { scope: ReadScope; initial: StoredRead | null; tz: string; title: string; canAsk: boolean }) {
  const { openAssistant } = useAIAssistant();
  const source = scope === "me" ? "from your leads, calls and tasks" : "from Pulse, leads and applications";
  const [read, setRead] = useState<StoredRead | null>(initial);
  const [state, setState] = useState<"loading" | "ready" | "paused" | "off">(initial ? "ready" : "loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Mount = Home was opened. With a read already stored this only records the open (the 7:00 job keys off it); otherwise it makes today's read.
    void post({ action: "open" }).then(({ data }) => {
      if (initial) return;
      if (!data?.ai) return setState("off");
      if (data.read) {
        setRead(data.read);
        setState("ready");
      } else setState(data.paused ? "paused" : "off");
    });
  }, [initial]);

  const refresh = async () => {
    setBusy(true);
    setNote(null);
    const { status, data } = await post({ action: "refresh" });
    setBusy(false);
    if (status === 429) return setNote("Remade 3 times today.");
    if (data?.paused) return setNote("Orca is paused until tomorrow.");
    if (!data?.ai || !data.read) return setNote("Couldn't remake it just now.");
    setRead(data.read);
  };
  const rate = async (value: 1 | -1) => {
    if (!read) return;
    setRead({ ...read, feedback: value });
    await post({ action: "feedback", value });
  };
  const ask = (text: string) => {
    const t = text.trim();
    if (t) openAssistant(t);
  };

  if (state === "off") return null;
  if (state === "paused") return <section className="eh-orca" aria-label={title}><div className="eh-orca-h"><span className="spk"><SparkleIcon size={14} aria-hidden /></span><span className="ti">{title}</span></div><div className="eh-orca-note">Orca is paused until tomorrow.</div></section>;
  if (state === "loading") {
    return (
      <section className="eh-orca" aria-label={title} aria-busy="true">
        <div className="eh-orca-h"><span className="spk"><SparkleIcon size={14} aria-hidden /></span><span className="ti">{title}</span></div>
        <div className="eh-orca-sk" aria-hidden><i /><i /><i /></div>
      </section>
    );
  }
  if (!read || read.points.length < 1) return null; // nothing worth saying: no card

  const left = refreshesLeft(read.refreshes);
  return (
    <section className="eh-orca" aria-label={title}>
      <div className="eh-orca-h">
        <span className="spk"><SparkleIcon size={14} aria-hidden /></span>
        <span className="ti">{title}</span>
        <span className="mt">· {madeAtLabel(new Date(read.madeAt), tz)} {source}</span>
        <span className="act">
          <button type="button" className="eh-orca-ic" aria-pressed={read.feedback === 1} onClick={() => rate(1)} aria-label="Helpful" title="Useful"><ThumbsUpIcon size={14} aria-hidden /></button>
          <button type="button" className="eh-orca-ic" aria-pressed={read.feedback === -1} onClick={() => rate(-1)} aria-label="Not helpful" title="Not useful"><ThumbsDownIcon size={14} aria-hidden /></button>
          <button type="button" className="eh-orca-ic" onClick={refresh} disabled={busy || left === 0} aria-label={left === 0 ? "Remade 3 times today" : "Remake Orca's read"} title={left === 0 ? "Remade 3 times today" : `Refresh (${left} left today)`}>
            <ArrowsClockwiseIcon size={14} aria-hidden />
          </button>
        </span>
      </div>
      <ol className="eh-orca-pts">
        {read.points.map((p, i) => (
          <li key={i}>
            <span className="n" aria-hidden>{i + 1}</span>
            <span>
              <b>{p.claim}</b> {p.reason}
              <Link href={p.link.href} className="lk">{p.link.label}</Link>
            </span>
          </li>
        ))}
      </ol>
      {note ? <div className="eh-orca-note" role="status">{note}</div> : null}
      {canAsk ? (
        <form className="eh-orca-ask" onSubmit={(e) => { e.preventDefault(); ask(q); setQ(""); }}>
          <span className="eh-orca-in">
            <SparkleIcon size={14} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask Orca about your day" aria-label="Ask Orca" />
            <button type="submit" className="eh-orca-go" aria-label="Ask" disabled={!q.trim()}><ArrowUpIcon size={12} aria-hidden /></button>
          </span>
          {ASK_CHIPS[scope].map((c) => (
            <button key={c} type="button" className="eh-orca-q" onClick={() => ask(c)}>{c}</button>
          ))}
        </form>
      ) : null}
    </section>
  );
}
