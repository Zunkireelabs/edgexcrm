"use client";

import "./home.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  BellIcon,
  CaretDownIcon,
  FileXIcon,
  PhoneXIcon,
  SnowflakeIcon,
  ListChecksIcon,
  PulseIcon,
  TrendDownIcon,
  TrendUpIcon,
  UserPlusIcon,
  UserSwitchIcon,
  UsersIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { sliceAssignments, type NeedsAction, type NeedsYouRow } from "../lib/needs-you";
import { rankItems } from "../lib/rank";
import type { ManagerData } from "../server/load-manager";
import { DoNextRow, MissedCallbacksSheet, useDoNextRows } from "./do-next-row";

const ICONS = {
  "user-plus": UserPlusIcon,
  "trend-down": TrendDownIcon,
  "file-x": FileXIcon,
  bell: BellIcon,
  "list-checks": ListChecksIcon,
  "user-switch": UserSwitchIcon,
  "phone-x": PhoneXIcon,
  snowflake: SnowflakeIcon,
} as const;

async function postJson(url: string, method: string, body?: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => null)) as { error?: { message?: string; details?: Record<string, string[]> } } | null;
    return { ok: false, message: (j?.error?.details ? Object.values(j.error.details).flat()[0] : undefined) ?? j?.error?.message ?? `Request failed (${res.status})` };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

function NeedsAction({ action, primary, onDone }: { action: NeedsAction; primary: boolean; onDone: (key?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const variant = primary && "primary" in action && action.primary ? "primary" : "secondary";
  if (action.type === "note") return <span className="eh-nudged">{action.label}</span>;
  if (action.type === "link") {
    return (
      <Button look="v2" variant={variant} size="sm" asChild>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }
  if (action.type === "nudge") {
    return (
      <Button
        look="v2"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await postJson("/api/v1/home/nudge", "POST", { to_user_id: action.userId });
          setBusy(false);
          if (!r.ok) return toast.error(r.message ?? "Couldn't send the nudge");
          toast.success(`Nudged ${action.userName.split(/\s+/)[0]}`);
          onDone();
        }}
      >
        <BellIcon size={14} aria-hidden />
        {action.label}
      </Button>
    );
  }
  if (action.type === "clear_stale") return <ClearStale action={action} onDone={onDone} />;
  return (
    <Button
      look="v2"
      variant={variant}
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        // The existing bulk-assign endpoint (max 100 ids per call), one target at a time, in plan order.
        for (const slice of sliceAssignments(action.leadIds, action.assignments)) {
          for (let i = 0; i < slice.ids.length; i += 100) {
            const r = await postJson("/api/v1/leads/bulk", "PATCH", { ids: slice.ids.slice(i, i + 100), assigned_to: slice.userId });
            if (!r.ok) {
              setBusy(false);
              return toast.error(r.message ?? "Couldn't assign");
            }
          }
        }
        setBusy(false);
        toast.success(`Assigned ${action.leadIds.length} ${action.leadIds.length === 1 ? "lead" : "leads"}`);
        onDone("unassigned");
      }}
    >
      {action.label}
    </Button>
  );
}

/** "Clear them": confirm the count, then the server recomputes the set and clears it through the audited patch path. */
function ClearStale({ action, onDone }: { action: Extract<NeedsAction, { type: "clear_stale" }>; onDone: (key?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(action.count);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/home/clear-stale-callbacks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expected_count: count }) });
      const j = (await res.json().catch(() => null)) as { data?: { cleared: number; failed: number; remaining: number }; error?: { details?: { count?: number }; message?: string } } | null;
      if (res.status === 409 && typeof j?.error?.details?.count === "number") {
        setCount(j.error.details.count);
        setChanged(true);
        return;
      }
      if (!res.ok || !j?.data) return toast.error(j?.error?.message ?? "Couldn't clear them");
      const { cleared, failed, remaining } = j.data;
      toast.success(`Cleared ${cleared} ${cleared === 1 ? "reminder" : "reminders"}${failed ? ` (${failed} failed)` : ""}${remaining ? `, ${remaining} left` : ""}`);
      setOpen(false);
      onDone(remaining === 0 ? "stale_callbacks" : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button look="v2" variant="secondary" size="sm" onClick={() => { setChanged(false); setOpen(true); }}>{action.label}</Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear {count} call-back {count === 1 ? "reminder" : "reminders"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {changed ? `The number changed while you were looking: it is now ${count}. ` : ""}
              These are reminders over 2 weeks old. Only the reminder is removed (each change is recorded on the lead); calls and notes stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy || count === 0} onClick={(e) => { e.preventDefault(); void run(); }}>
              {busy ? "Clearing" : `Clear ${count}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ManagerHome({ data }: { data: ManagerData }) {
  const router = useRouter();
  const rows = useDoNextRows();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [ownOpen, setOwnOpen] = useState(false);

  const needs = data.needsYou.filter((r) => !gone.has(r.key));
  const firstPrimaryRow = needs.findIndex((r) => r.actions.some((a) => "primary" in a && a.primary));
  const ownItems = rankItems(data.own.doNext.items.filter((i) => !rows.hidden.has(i.key)));
  // One collapsed row, then "Show N more": the leave request (if any) leads, else the first item.
  const ownTotal = ownItems.length + (data.leaveWaiting > 0 ? 1 : 0);
  const ownShown = ownOpen ? ownItems : ownItems.slice(0, data.leaveWaiting > 0 ? 0 : 1);
  const ownHidden = ownItems.length - ownShown.length;

  return (
    <div className="eh">
      {ownItems.filter((i) => i.children).map((i) => (
        <MissedCallbacksSheet key={i.key} item={i} nextStageByLead={data.own.nextStageByLead} tz={data.tz} rows={rows} />
      ))}
      <h1 className="eh-h1">{data.greeting}</h1>
      <p className="eh-lede">{data.lede}</p>
      <div className="eh-cols">
        <section aria-label="Needs you">
          <div className="eh-sh">
            <h2>Needs you</h2>
            <span className="eh-count">{needs.length}</span>
            {data.canOpenPulse ? (
              <Button look="v2" variant="ghost" size="sm" asChild className="eh-seg">
                <Link href="/pulse"><PulseIcon size={14} aria-hidden />All in Pulse</Link>
              </Button>
            ) : null}
          </div>
          <div className="eh-list">
            {needs.length === 0 ? <div className="eh-note" style={{ padding: "16px 14px" }}>Nothing needs you right now.</div> : null}
            {needs.map((r: NeedsYouRow, idx) => {
              const Icon = ICONS[r.icon];
              return (
                <div key={r.key} className="eh-it">
                  <span className={`eh-ic ${r.tone === "neutral" ? "" : r.tone}`}><Icon size={18} aria-hidden /></span>
                  <div style={{ minWidth: 0 }}>
                    <div className="eh-tl">
                      <span className="eh-nm">{r.title}</span>
                      {r.chip ? <span className={`eh-chip ${r.chip.tone === "neutral" ? "" : r.chip.tone}`}>{r.chip.text}</span> : null}
                    </div>
                    <div className="eh-wh">{r.why}</div>
                  </div>
                  <div className="eh-ac">
                    {r.actions.map((a, i) => (
                      <NeedsAction
                        key={`${r.key}-${i}`}
                        action={a}
                        primary={idx === firstPrimaryRow}
                        onDone={(key) => { if (key) setGone((s) => new Set(s).add(key)); router.refresh(); }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="eh-tier" style={{ marginTop: 22 }}>
            <span className="t">Your own to-dos</span>
            <span className="d">{ownTotal} · leads and tasks assigned to you</span>
          </div>
          <div className="eh-list">
            {data.leaveWaiting > 0 ? (
              <div className="eh-it">
                <span className="eh-ic"><ListChecksIcon size={18} aria-hidden /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="eh-tl"><span className="eh-nm">{data.leaveWaiting} leave {data.leaveWaiting === 1 ? "request" : "requests"} waiting on you</span></div>
                  <div className="eh-wh">Approve or decline so people can plan</div>
                </div>
                <div className="eh-ac"><Button look="v2" variant="secondary" size="sm" asChild><Link href="/leave">Review</Link></Button></div>
              </div>
            ) : null}
            {ownShown.map((item) => (
              <DoNextRow
                key={item.key}
                item={item}
                nextStage={item.primaryAction.type === "call" ? data.own.nextStageByLead[item.primaryAction.leadId] ?? null : null}
                tz={data.tz}
                rows={rows}
              />
            ))}
            {ownTotal === 0 ? <div className="eh-note" style={{ padding: "16px 14px" }}>You&apos;re on top of your own work.</div> : null}
            {!ownOpen && ownHidden > 0 ? (
              <button type="button" className="eh-more" onClick={() => setOwnOpen(true)}>
                Show {ownHidden} more <CaretDownIcon size={14} aria-hidden />
              </button>
            ) : null}
          </div>
        </section>

        <aside className="eh-side" aria-label="Needs a look and impact">
          <div className="eh-card">
            <div className="eh-ch">
              <UsersIcon size={16} aria-hidden />
              <h3>Needs a look</h3>
              {data.canOpenPulse ? <Link href="/pulse" className="r">Open Pulse →</Link> : null}
            </div>
            {data.needsALook.rows.map((p) => (
              <div key={p.userId} className="eh-pp">
                <span className={`eh-av ${p.tone}`} aria-hidden>{p.initials}</span>
                <div className="x">{p.name}<span>{p.sub}</span></div>
                <span className="v" title={p.unit}><span className={`eh-fl ${p.tone}`} />{p.value}</span>
              </div>
            ))}
            <div className="eh-note"><span className="eh-fl good" />{data.needsALook.others} {data.needsALook.others === 1 ? "other" : "others"} on track</div>
          </div>

          <div className="eh-card">
            <div className="eh-ch"><TrendUpIcon size={16} aria-hidden /><h3>Is the new Home helping?</h3></div>
            <ImpactBody data={data} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function ImpactBody({ data }: { data: ManagerData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { impact } = data;
  if (impact.status === "unset") {
    return (
      <div className="eh-note">
        Measuring starts when Home goes live.
        {data.canSetLaunch ? (
          <div style={{ marginTop: 8 }}>
            <Button
              look="v2"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await postJson("/api/v1/home/launch", "POST");
                setBusy(false);
                if (!r.ok) return toast.error(r.message ?? "Couldn't save");
                router.refresh();
              }}
            >
              Start measuring today
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  if (impact.status === "measuring") return <div className="eh-note">Measuring since {impact.since}.</div>;
  return (
    <>
      <div className="eh-sub">Last 3 weeks vs the 4 weeks before it went live</div>
      {impact.rows.map((r) => (
        <div key={r.key} className="eh-met">
          <span className="k">{r.label}</span>
          <span className="v">{r.value}</span>
          {r.was ? <span className={`u ${r.tone === "neutral" ? "" : r.tone}`}>{r.was}</span> : null}
        </div>
      ))}
    </>
  );
}
