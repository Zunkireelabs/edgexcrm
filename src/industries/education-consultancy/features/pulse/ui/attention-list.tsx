"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { countByCategory } from "../lib/attention";
import type { AttentionCategory, AttentionItem, AttentionLink, EventsQuery } from "../lib/types";
import { Chevron, ItemIcon, Spark } from "./icons";

type Filter = "all" | AttentionCategory;
const SECTIONS: Array<{ key: AttentionCategory; label: string }> = [
  { key: "needs_action", label: "Needs action" },
  { key: "heads_up", label: "Heads-up" },
  { key: "wins", label: "Wins" },
];

/**
 * The ONE "Needs your attention" list (replaces Key changes + Needs you). Rows read like sentences; the first row is
 * expanded; dismissals are kept per user per window in local state (a persisted store is a later ticket).
 */
export function AttentionList({
  items, mode, windowKey, onDrill, onPerson,
}: {
  items: AttentionItem[];
  mode: "preview" | "off";
  windowKey: string;
  onDrill: (title: string, crumbs: string[], q: EventsQuery) => void;
  onPerson: (userId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  const [openId, setOpenId] = useState<string | null | undefined>(undefined); // undefined = default (first item)
  const live = useMemo(() => items.filter((i) => !dismissed[`${windowKey}:${i.id}`]), [items, dismissed, windowKey]);
  const counts = countByCategory(live);
  const shown = live.filter((i) => filter === "all" || i.category === filter);
  const firstId = shown[0]?.id ?? null;
  const expanded = openId === undefined ? firstId : openId;
  const preview = mode === "preview";

  const pills: Array<{ key: Filter; label: string; n: number }> = [
    { key: "all", label: "All", n: counts.all },
    { key: "needs_action", label: "Needs action", n: counts.needs_action },
    { key: "heads_up", label: "Heads-up", n: counts.heads_up },
    { key: "wins", label: "Wins", n: counts.wins },
  ];

  const link = (l: AttentionLink, it: AttentionItem) =>
    l.href ? (
      <Button key={l.label} look="v2" variant="link" asChild><Link href={l.href}>{l.label}</Link></Button>
    ) : (
      <Button key={l.label} look="v2" variant="link" type="button"
        onClick={() => (l.personId ? onPerson(l.personId) : l.drill && onDrill(`${it.subject} · ${it.what}`, [it.subject], l.drill))}>
        {l.label}
      </Button>
    );

  return (
    <div className="att">
      <div className="att-h">
        <div className="row"><span className="h2">Needs your attention</span>{counts.needs_action > 0 && <Badge look="v2" variant="count" className="ml-2">{counts.needs_action}</Badge>}</div>
        <SegmentedControl
          variant="pills"
          aria-label="Filter attention"
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          items={pills.map((p) => ({ value: p.key, label: p.label, count: p.n }))}
        />
      </div>
      <div className="list">
        {shown.length === 0 && <div className="sec" style={{ padding: "22px 4px", color: "var(--muted)" }}>Nothing here right now.</div>}
        {SECTIONS.map((sec) => {
          const rows = shown.filter((i) => i.category === sec.key);
          if (rows.length === 0) return null;
          return (
            <div key={sec.key}>
              <div className="sec cap">{sec.label} · {rows.length}</div>
              {rows.map((it) => {
                const open = expanded === it.id;
                return (
                  <div key={it.id} className={`it ${open ? "open" : ""}`} onClick={() => setOpenId(open ? null : it.id)} role="button" tabIndex={0}
                    aria-expanded={open} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(open ? null : it.id); } }}>
                    <span className={`ic ${it.tone}`}><ItemIcon icon={it.icon} /></span>
                    <div className="ln" title={`${it.subject} · ${it.what}`}>
                      <b>{it.subject}</b><span className="sep">·</span>{it.what}
                      {it.suggested && preview && <Badge look="v2" variant="ai" className="ml-2 align-[1px]">Suggested</Badge>}
                    </div>
                    <div className="row" onClick={(e) => e.stopPropagation()}>
                      {it.figure && (it.figure.textFirst
                        ? <span className="fig" title={`${it.figure.text} ${it.figure.strong ?? ""}`.trim()}>{it.figure.text} {it.figure.strong && <b>{it.figure.strong}</b>}</span>
                        : <span className="fig" title={`${it.figure.strong ?? ""}${it.figure.text}`}>{it.figure.strong && <b>{it.figure.strong}</b>}{it.figure.text}</span>)}
                      {it.action && it.action.personId && <Button look="v2" variant={it.action.primary ? "primary" : "secondary"} type="button" title={it.action.label} className="pact" onClick={() => onPerson(it.action!.personId!)}>{it.action.label}</Button>}
                      {it.action && !it.action.personId && it.action.drill && <Button look="v2" variant={it.action.primary ? "primary" : "secondary"} type="button" title={it.action.label} className="pact" onClick={() => onDrill(`${it.subject} · ${it.what}`, [it.subject], it.action!.drill!)}>{it.action.label}</Button>}
                      {it.action && !it.action.personId && !it.action.drill && <Button look="v2" variant={it.action.primary ? "primary" : "secondary"} asChild className="pact"><Link href={it.action.href} title={it.action.label}>{it.action.label}</Link></Button>}
                    </div>
                    <span className="chev"><Chevron open={open} /></span>
                    {open && (
                      <div className="exp" onClick={(e) => e.stopPropagation()}>
                        {it.why && (preview ? (
                          <div className="read" style={{ margin: "2px 0 0" }}>
                            <div className="lb"><Spark />{it.category === "needs_action" ? "Why Orca suggests this" : "What Orca sees"}</div>
                            <p style={{ fontSize: 13.5 }}>{it.why}</p>
                          </div>
                        ) : (
                          <p>{it.why}</p>
                        ))}
                        {it.meta && <div className="meta">{it.meta}</div>}
                        <div className="links">
                          {it.links.map((l) => link(l, it))}
                          <Button look="v2" variant="ghost" size="sm" type="button" className="ml-auto px-3"
                            onClick={() => setDismissed((d) => ({ ...d, [`${windowKey}:${it.id}`]: true }))}>Dismiss</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
