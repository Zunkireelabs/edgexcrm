"use client";

import "./home.css";
import { useEffect, useState } from "react";
import { PhoneIcon, SparkleIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { DoNextItem } from "../lib/types";

interface PrepData {
  ai: boolean;
  paused?: boolean;
  leadName: string;
  firstName: string;
  chips: { source: string | null; phone: string | null };
  known: Array<{ k: string; v: string }>;
  ask: Array<{ key: string; label: string }>;
  opening: string | null;
  kb: { text: string; source: string; page: number | null } | null;
}

/**
 * H3c: before a first call. What we know (the record as it is), what is missing (the Ask-about list), Orca's opening line and, only on
 * a real knowledge-base match, one fact with its file and page. "Call <name>" is the row's own call action; the call log opens after it.
 * Render with `key={item?.key}` so each row opens a fresh panel.
 */
export function CallPrepPanel({ item, onClose, onCall }: { item: DoNextItem | null; onClose: () => void; onCall: (item: DoNextItem) => void }) {
  const [data, setData] = useState<PrepData | null>(null);
  const [failed, setFailed] = useState(false);
  const leadId = item?.leadId ?? null;

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/v1/home/call-prep", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId }) });
        const j = (await res.json().catch(() => null)) as { data?: PrepData } | null;
        if (cancelled) return;
        if (!res.ok || !j?.data?.ai) return setFailed(true);
        setData(j.data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [leadId]);

  const call = item?.primaryAction.type === "call" ? item.primaryAction : null;
  const first = data?.firstName ?? call?.leadName.split(" ")[0] ?? "";
  const violet = (data?.opening ? 1 : 0) + (data?.kb ? 1 : 0);

  return (
    <Sheet open={!!item} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent look="v2" size="md">
        <SheetHeader>
          <SheetTitle><span className="eh-dp-title"><SparkleIcon size={16} aria-hidden /><span>Before you call {data?.leadName ?? call?.leadName ?? ""}</span></span></SheetTitle>
          <SheetDescription className="sr-only">What we know about this lead, what is missing, and an opening line. Nothing is sent.</SheetDescription>
          <div className="eh-dp-chips">
            {item ? <span className="eh-chip new">{item.chip.text}</span> : null}
            {data?.chips.source ? <span className="eh-chip">{data.chips.source}</span> : null}
            {data?.chips.phone ? <span className="eh-chip">{data.chips.phone}</span> : null}
          </div>
        </SheetHeader>
        <div className="eh-dp">
          {failed ? <p className="eh-dp-why">Couldn&apos;t load the prep just now. You can still call.</p> : null}
          {!data && !failed ? <div className="eh-orca-sk" aria-busy="true"><i /><i /><i /></div> : null}
          {data ? (
            <>
              <section aria-label="What we know">
                <h3 className="eh-cp-h">What we know</h3>
                <dl className="eh-cp-dl">
                  {data.known.map((r) => (
                    <div key={r.k}><dt>{r.k}</dt><dd>{r.v}</dd></div>
                  ))}
                </dl>
              </section>
              {data.ask.length > 0 ? (
                <section aria-label="Ask about">
                  <h3 className="eh-cp-h">Ask about (missing on the record)</h3>
                  <div className="eh-opts">{data.ask.map((a) => <span key={a.key} className="eh-chip">{a.label}</span>)}</div>
                </section>
              ) : null}
              {data.opening ? (
                <div className="eh-dp-draft">
                  <div className="eh-dp-by"><SparkleIcon size={14} aria-hidden /> Opening line<span>Orca</span></div>
                  <p className="eh-dp-text">{data.opening}</p>
                </div>
              ) : null}
              {data.kb ? (
                <div className="eh-dp-draft">
                  <div className="eh-dp-by"><SparkleIcon size={14} aria-hidden /> From your knowledge base<span>{data.kb.source}{data.kb.page ? ` · p. ${data.kb.page}` : ""}</span></div>
                  <p className="eh-dp-text">{data.kb.text}</p>
                </div>
              ) : null}
              {data.paused ? <p className="eh-dp-why">Orca is paused until tomorrow. What we know is still here.</p> : null}
              <p className="eh-dp-why">
                Orca read only {first}&apos;s form answers{data.kb ? " and your knowledge base" : ""}. Facts on the record are shown as they are
                {violet > 0 ? `; the ${violet === 2 ? "two violet boxes are" : "violet box is"} Orca's` : ""}.
              </p>
            </>
          ) : null}
        </div>
        <div className="eh-dp-foot">
          <span className="eh-dp-note">After the call, one note fills in the record.</span>
          {call && item ? (
            <Button look="v2" variant="primary" size="sm" asChild>
              <a href={call.phone ? `tel:${call.phone}` : undefined} onClick={() => onCall(item)} aria-label={`Call ${first}`}>
                <PhoneIcon size={14} aria-hidden /> Call {first}
              </a>
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
