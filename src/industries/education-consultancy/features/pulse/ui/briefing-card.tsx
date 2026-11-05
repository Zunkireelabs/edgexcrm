"use client";

import Link from "next/link";
import type { Briefing, EventsQuery } from "../lib/types";
import { Arrow, ItemIcon, Spark } from "./icons";

const TIP = "Written from your data by rules. Full AI explanations switch on with Orca.";

/**
 * The briefing card (v5-s1). `source` is the seam for the LLM layer (EDGEX-83): "rules" is what is built — in Preview
 * mode every slot is filled by buildBriefing() from real numbers and every line drills to its records. In AI-off mode
 * the same content renders plain: no gradient, no badge, no Preview tag, no ask box.
 */
export function PulseBriefingCard({
  source, briefing, mode, title, time, askEnabled, onOpen,
}: {
  source: "rules" | "ai";
  briefing: Briefing;
  mode: "preview" | "off";
  title: string;
  time: string;
  askEnabled: boolean;
  onOpen: (title: string, crumbs: string[], q: EventsQuery) => void;
}) {
  void source;
  const preview = mode === "preview";
  return (
    <section className={`brief ${preview ? "" : "off"}`} aria-label="Briefing">
      <div className="bhd">
        <div className="bt">
          {preview && <span className="badge"><Spark /></span>}
          {title}
          {preview && <span className="prev" title={TIP}>Preview</span>}
        </div>
        {preview && <span className="meta">Orca · {time} · from {briefing.recordCount.toLocaleString("en-US")} activity records</span>}
      </div>

      {briefing.read &&
        (preview ? (
          <div className="read">
            <div className="lb"><Spark />Orca&apos;s read</div>
            <p>{briefing.read}</p>
          </div>
        ) : (
          <p className="plain-read">{briefing.read}</p>
        ))}

      {briefing.items.map((it) => (
        <div className="bi" key={it.id}>
          <span className={`tg ${it.tone === "bad" ? "r" : it.tone === "good" ? "g" : "b"}`}><ItemIcon icon={it.icon} /></span>
          <div>
            <p><b>{it.headline}</b>{it.detail ? ` ${it.detail}` : ""}</p>
            <div className="ev"><b>{it.evidenceLabel}</b>{it.evidence}</div>
          </div>
          <button type="button" className="go" onClick={() => onOpen(it.headline, ["Briefing"], it.link.drill)}>
            {it.link.label}<Arrow />
          </button>
        </div>
      ))}

      {preview && (
        askEnabled ? (
          <Link href="/orca" className="ask" aria-label="Ask Orca about this period">
            <span className="ic2"><Spark /></span>
            <span className="grow">Ask about this period…</span>
            <span className="chip">Why did the biggest drop happen?</span>
            <span className="chip">Compare branches</span>
          </Link>
        ) : (
          <div className="ask" aria-disabled="true" title="Orca answers switch on soon">
            <span className="ic2"><Spark /></span>
            <span className="grow">Ask about this period…</span>
            <span className="chip">Why did the biggest drop happen?</span>
            <span className="chip">Compare branches</span>
          </div>
        )
      )}
    </section>
  );
}
