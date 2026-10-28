"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail, MessageSquare, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSequences } from "../hooks/use-sequences";
import { CHANNEL_LABEL, type OutreachChannel } from "../lib/channel";
import { formatDate } from "../lib/format-due";
import {
  campaignStatusLabel,
  endedBecause,
  type LeadSubscriptions,
  type QueuedSequence,
  type SubscribedSequence,
} from "../lib/lead-subscriptions";
import { LeadCadenceStrip } from "./lead-cadence-strip";

// The lead page's "Subscribed" tab: everything this lead is (or was) subscribed to, in one place.
//   1. Running now  — the live email / SMS sequence (or an Enroll picker when a channel is free): the same strip as the Emails tab,
//                     read with the lead's own visibility so a branch manager / collaborator sees the true state.
//   2. Queue next   — for a channel that is busy: pick a sequence to start automatically when the current one ends.
//   3. History      — sequences that ended, and why.
//   4. Campaigns    — one-off email / SMS campaigns the lead was sent.

interface LeadSubscriptionsTabProps {
  leadId: string;
  isAdmin: boolean;
  currentUserId: string;
  leadFirstName?: string | null;
  leadLastName?: string | null;
  leadEmail?: string | null;
}

const EMPTY: LeadSubscriptions = { sequences: [], queued: [], campaigns: [], autoEnrollOptOuts: { email: false, sms: false } };

/** How many rows a list shows before "Show all". */
const PREVIEW_ROWS = 5;

/** A clear "Email" / "SMS" tag (icon + word, its own colour) so the two channels can't be confused. */
function ChannelTag({ channel }: { channel: OutreachChannel }) {
  const isSms = channel === "sms";
  const Icon = isSms ? MessageSquare : Mail;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        isSms ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
      }`}
    >
      <Icon className="h-3 w-3" />
      {CHANNEL_LABEL[channel]}
    </span>
  );
}

export function LeadSubscriptionsTab(props: LeadSubscriptionsTabProps) {
  const { leadId } = props;
  const [data, setData] = useState<LeadSubscriptions>(EMPTY);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Bumped after a queue change so the "Running now" strips re-read (a queued sequence can start straight away).
  const [stripKey, setStripKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/subscriptions`);
      if (!res.ok) throw new Error("load failed");
      const json = await res.json();
      setData((json.data as LeadSubscriptions | undefined) ?? EMPTY);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  const afterQueueChange = () => {
    load();
    setStripKey((k) => k + 1);
  };

  const live = data.sequences.filter((s) => s.live);
  const past = data.sequences.filter((s) => !s.live);
  const busyChannels = (["email", "sms"] as const).filter((c) => live.some((s) => s.channel === c));

  return (
    <div className="space-y-4">
      <Section title="Running now" hint="A lead runs at most one email and one SMS sequence at a time.">
        <LeadCadenceStrip key={stripKey} {...props} readFromLead labelled onChanged={load} />
      </Section>

      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading subscriptions…
        </div>
      )}
      {status === "error" && (
        <Card className="shadow-none rounded-lg py-0">
          <CardContent className="p-4 flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Couldn&apos;t load this lead&apos;s subscriptions.</span>
            <Button type="button" size="sm" variant="outline" onClick={load}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {status === "ready" && (
        <>
          {busyChannels.length > 0 && (
            <Section title="Queue next" hint="Starts automatically when the current sequence on that channel ends.">
              <div className="space-y-2">
                {busyChannels.map((channel) => (
                  <QueueRow
                    key={channel}
                    leadId={leadId}
                    channel={channel}
                    running={live.find((s) => s.channel === channel)!}
                    queued={data.queued.find((q) => q.channel === channel) ?? null}
                    onChanged={afterQueueChange}
                  />
                ))}
              </div>
            </Section>
          )}

          <Section title="History" count={past.length}>
            {past.length === 0 ? (
              <Empty>No past sequences yet.</Empty>
            ) : (
              <ShortList items={past} render={(s) => <PastRow key={s.id} s={s} />} />
            )}
          </Section>

          <Section title="Campaigns" count={data.campaigns.length} hint="One-off email and SMS campaigns this lead was sent.">
            {data.campaigns.length === 0 ? (
              <Empty>This lead hasn&apos;t been sent any campaigns.</Empty>
            ) : (
              <ShortList
                items={data.campaigns}
                render={(c) => (
                  <li key={`${c.channel}-${c.id}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <ChannelTag channel={c.channel} />
                      <span className="truncate font-medium">{c.name}</span>
                      {c.campaignDeleted && <span className="shrink-0 text-xs text-muted-foreground">(campaign deleted)</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">{campaignStatusLabel(c.status)}</Badge>
                      {formatDate(c.at)}
                    </span>
                  </li>
                )}
              />
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, count, hint, children }: { title: string; count?: number; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
          {count ? ` (${count})` : ""}
        </h4>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">{children}</p>;
}

/** The latest PREVIEW_ROWS rows, with "Show all (n)" / "Show less" when there are more. */
function ShortList<T>({ items, render }: { items: T[]; render: (item: T) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, PREVIEW_ROWS);
  return (
    <div className="space-y-1">
      <ul className="divide-y rounded-lg border bg-card">{shown.map(render)}</ul>
      {items.length > PREVIEW_ROWS && (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show all (${items.length})`}
        </Button>
      )}
    </div>
  );
}

function PastRow({ s }: { s: SubscribedSequence }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <ChannelTag channel={s.channel} />
        <span className="truncate font-medium">{s.sequenceName}</span>
        {s.source === "stage_rule" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            <Zap className="h-3 w-3" aria-hidden />
            Auto-enrolled{s.triggerStageName ? ` · entered ${s.triggerStageName}` : ""}
          </span>
        )}
        <span className="text-xs text-muted-foreground">{endedBecause(s)}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatDate(s.startedAt)}
        {s.endedAt ? ` → ${formatDate(s.endedAt)}` : ""}
      </span>
    </li>
  );
}

function QueueRow({
  leadId,
  channel,
  running,
  queued,
  onChanged,
}: {
  leadId: string;
  channel: OutreachChannel;
  running: SubscribedSequence;
  queued: QueuedSequence | null;
  onChanged: () => void;
}) {
  const { sequences } = useSequences(channel);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const choices = sequences.filter((s) => s.status === "active" && s.id !== running.sequenceId);

  const queue = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/subscriptions/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequence_id: selected }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? "Couldn't queue the sequence");
        return;
      }
      toast.success(json?.data?.startedNow ? "The current sequence had ended — the new one started now." : "Queued — it starts when the current one ends.");
      setSelected("");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!queued) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/subscriptions/queue?queue_id=${queued.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error?.message ?? "Couldn't remove it from the queue");
        return;
      }
      toast.success("Removed from the queue");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <ChannelTag channel={channel} />
      {queued ? (
        <>
          <span className="font-medium">{queued.sequenceName}</span>
          <span className="text-xs text-muted-foreground">starts after {running.sequenceName}</span>
          <Button type="button" variant="ghost" size="sm" className="ml-auto" disabled={busy} onClick={remove}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5 mr-1" />}
            Remove
          </Button>
        </>
      ) : choices.length === 0 ? (
        <span className="text-muted-foreground">No other active {CHANNEL_LABEL[channel].toLowerCase()} sequence to queue.</span>
      ) : (
        <>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-8 w-56" aria-label={`Queue next ${CHANNEL_LABEL[channel]} sequence`}>
              <SelectValue placeholder="Pick a sequence…" />
            </SelectTrigger>
            <SelectContent>
              {choices.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" disabled={!selected || busy} onClick={queue}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Queue next"}
          </Button>
        </>
      )}
    </div>
  );
}
