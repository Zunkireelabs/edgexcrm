"use client";

import "./home.css";
import Link from "next/link";
import { useState } from "react";
import { CalendarBlankIcon, CaretDownIcon, PulseIcon, SealCheckIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { filterItems } from "../lib/build";
import { VISIBLE_LIMIT } from "../lib/rank";
import type { DoNextFilter, DoNextTier } from "../lib/types";
import type { HomeData } from "../server/load-page";
import { DoNextRow, MissedCallbacksSheet, useDoNextRows } from "./do-next-row";

const TIERS: Array<{ tier: DoNextTier; title: string; desc: string }> = [
  { tier: "now", title: "Now", desc: "new leads, replies waiting, anything overdue" },
  { tier: "today", title: "Today", desc: "booked call-backs, deadlines this week, tasks due" },
  { tier: "week", title: "This week", desc: "leads going quiet, files stuck in a stage" },
];


const FILTER_LABELS: Array<[DoNextFilter, string]> = [
  ["all", "All"],
  ["calls", "Calls"],
  ["messages", "Messages"],
  ["documents", "Documents"],
  ["tasks", "Tasks"],
];

export function EducationHome({ data }: { data: HomeData }) {
  const rows = useDoNextRows();
  const [filter, setFilter] = useState<DoNextFilter>("all");
  const [showAll, setShowAll] = useState(false);

  const visibleAll = data.doNext.items.filter((i) => !rows.hidden.has(i.key));
  const filtered = filterItems(visibleAll, filter);
  const shown = showAll ? filtered : filtered.slice(0, VISIBLE_LIMIT);
  const hiddenCount = filtered.length - shown.length;

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
      {visibleAll.filter((i) => i.children).map((i) => (
        <MissedCallbacksSheet key={i.key} item={i} nextStageByLead={data.nextStageByLead} tz={data.tz} rows={rows} />
      ))}
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
              const tierRows = shown.filter((i) => i.tier === tier);
              if (tierRows.length === 0) return null;
              const isLastTier = tier === [...TIERS].reverse().find((t) => shown.some((i) => i.tier === t.tier))?.tier;
              return (
                <div key={tier}>
                  <div className="eh-tier"><span className="t">{title}</span><span className="d">{desc}</span></div>
                  <div className="eh-list">
                    {tierRows.map((item) => (
                      <DoNextRow key={item.key} item={item} nextStage={data.nextStageByLead[item.leadId ?? ""] ?? (item.primaryAction.type === "call" ? data.nextStageByLead[item.primaryAction.leadId] ?? null : null)} tz={data.tz} rows={rows} />
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

