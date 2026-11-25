"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChatTextIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { mergeById, useQuietPoll } from "@/lib/inbox/quiet-refresh";
import { cn } from "@/lib/utils";

// "New website chat": a card in the bottom-right corner of ANY EdgeX page when a visitor writes in the website chat and
// nobody has accepted it yet. Accept makes it yours (the first person wins); View just opens it. Everyone who can open
// the Inbox sees it. Mounted once, in the app shell, only for people whose position allows the Inbox.
//
// How it stays correct:
//   - the server list (/api/v1/inbox/pending-claims) is the source of truth: loaded on mount, every 15 s, when the tab
//     becomes visible again, and right after anything happens on the live feed;
//   - the live feed (Supabase realtime on `messages`, the same one the Inbox uses) only says "something changed, look
//     again": a visitor message, or the grey "accepted" note that makes a card disappear for everyone else.

const POLL_MS = 15_000;
// A card someone else accepted stays this long as "taken care of", so a click can never land on a card that vanished.
const LEAVE_MS = 2_000;
const MAX_VISIBLE = 3;
const MUTE_KEY = "edgex:chat-sound-muted";
const OURS = /^\(\d+\) New chat · EdgeX$/;

interface PendingChat {
  id: string;
  contact_display_name: string | null;
  contact_phone: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  /** The Admizz AI is answering this chat (nobody has accepted it yet). */
  ai_replying?: boolean;
  /** The AI handed this chat over: a person is needed. */
  needs_human?: boolean;
}

/** A short, soft two-note chime. Never throws: browsers only allow sound after the person has clicked on the page once. */
function playDing() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    void ctx.resume?.();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.14;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    });
    setTimeout(() => void ctx.close?.(), 900);
  } catch {
    // no audio available: stay silent
  }
}

function ago(iso: string | null): string {
  if (!iso) return "just now";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export function IncomingChatPopup({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState<PendingChat[]>([]);
  // Chats this person opened with View but didn't accept: hidden until the visitor writes again.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  // Chats already shown, so the chime plays only for a NEW one. null until the first load (no chime on page load).
  const seen = useRef<Set<string> | null>(null);
  const origTitle = useRef<string | null>(null);

  const pendingRef = useRef<PendingChat[]>([]);
  const dismissedRef = useRef<Set<string>>(new Set());
  const acceptingRef = useRef<string | null>(null);
  const [leaving, setLeaving] = useState<PendingChat[]>([]);
  const leaveTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    dismissedRef.current = dismissed;
  }, [dismissed]);
  useEffect(() => {
    const timers = leaveTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  // Throws when the server can't be reached, so the poller backs off quietly (the screen just keeps what it has).
  const refresh = useCallback(async () => {
    const res = await fetch("/api/v1/inbox/pending-claims");
    if (!res.ok) throw new Error("pending-claims failed");
    const json = (await res.json()) as { data?: PendingChat[] };
    const rows = json.data ?? [];
    // Cards that were showing and are now gone (somebody accepted, or it closed): keep them a moment, marked as handled.
    const gone = pendingRef.current.filter(
      (p) => !rows.some((r) => r.id === p.id) && !dismissedRef.current.has(p.id) && p.id !== acceptingRef.current,
    );
    if (gone.length > 0) {
      setLeaving((l) => [...l, ...gone.filter((g) => !l.some((x) => x.id === g.id))]);
      gone.forEach((g) => {
        leaveTimers.current.push(setTimeout(() => setLeaving((l) => l.filter((x) => x.id !== g.id)), LEAVE_MS));
      });
    }
    pendingRef.current = rows;
    setPending((prev) => mergeById(prev, rows));
    if (seen.current === null) {
      seen.current = new Set(rows.map((r) => r.id));
    } else {
      const fresh = rows.filter((r) => !seen.current!.has(r.id));
      fresh.forEach((r) => seen.current!.add(r.id));
      if (fresh.length > 0 && !mutedRef.current) playDing();
    }
  }, []);
  const trigger = useQuietPoll(refresh, POLL_MS);

  // The person's choice to mute the chime (per browser).
  useEffect(() => {
    try {
      const m = window.localStorage.getItem(MUTE_KEY) === "1";
      mutedRef.current = m;
      setMuted(m);
    } catch {
      // storage blocked: default to sound on
    }
  }, []);
  const toggleMute = () => {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    try {
      window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  // Load now; then the quiet poll keeps it fresh (every 15 s, only while the tab is visible, and when it comes back).
  useEffect(() => {
    void trigger();
  }, [trigger]);

  // Live feed: any new message for this team means "look again" (a visitor wrote, or someone accepted / handed over).
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let later: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`incoming-chat-popup-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const m = payload.new as { conversation_id?: string; author_type?: string };
          if (m.author_type === "customer" && m.conversation_id) {
            const convId = m.conversation_id;
            // The visitor wrote again: a chat someone only viewed should offer itself again.
            setDismissed((prev) => {
              if (!prev.has(convId)) return prev;
              const next = new Set(prev);
              next.delete(convId);
              return next;
            });
          }
          if (timer) clearTimeout(timer);
          if (later) clearTimeout(later);
          timer = setTimeout(() => void trigger(), 250);
          // Again a moment later: the message can arrive a hair before the chat's preview / owner is saved.
          later = setTimeout(() => void trigger(), 1500);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      if (later) clearTimeout(later);
      supabase.removeChannel(channel);
    };
  }, [tenantId, trigger]);

  const cards = pending.filter((c) => !dismissed.has(c.id));

  // A waiting chat shows in the browser tab too, so it isn't missed when EdgeX isn't the tab in front.
  useEffect(() => {
    const cur = document.title;
    if (!OURS.test(cur)) origTitle.current = cur;
    if (cards.length > 0) {
      document.title = `(${cards.length}) New chat · EdgeX`;
    } else if (OURS.test(cur) && origTitle.current !== null) {
      document.title = origTitle.current;
    }
  }, [cards.length, pathname]);

  const accept = async (chat: PendingChat) => {
    if (busyId) return;
    setBusyId(chat.id);
    acceptingRef.current = chat.id;
    try {
      const res = await fetch(`/api/v1/inbox/conversations/${chat.id}/claim`, { method: "POST" });
      if (res.ok) {
        toast.success("You're handling this chat");
        router.push(`/inbox?conversation=${chat.id}`);
      } else {
        // Someone was faster (or it changed): say who, and let the card go.
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(json?.error?.message ?? "Couldn't accept this chat");
      }
    } finally {
      setBusyId(null);
      await refresh().catch(() => {});
      acceptingRef.current = null;
    }
  };

  const view = (chat: PendingChat) => {
    setDismissed((prev) => new Set(prev).add(chat.id));
    router.push(`/inbox?conversation=${chat.id}`);
  };

  const handled = leaving.filter((l) => !pending.some((p) => p.id === l.id));
  if (cards.length === 0 && handled.length === 0) return null;

  const visible = cards.slice(0, MAX_VISIBLE);
  const extra = cards.length - visible.length;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2 print:hidden"
      aria-live="polite"
      data-incoming-chats
    >
      {visible.map((chat) => {
        const name = chat.contact_display_name || chat.contact_phone || "A visitor";
        return (
          <div key={chat.id} role="alert" className="rounded-xl border bg-white p-3 shadow-lg flex flex-col gap-1.5" data-chat-card>
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className={cn("flex items-center gap-1.5", chat.needs_human && "text-red-600")} data-chat-kind={chat.needs_human ? "needs-human" : chat.ai_replying ? "ai-replying" : "new"}>
                <ChatTextIcon className="h-3.5 w-3.5" /> {chat.needs_human ? "Needs a human" : "New website chat"}
                {!chat.needs_human && chat.ai_replying && (
                  <span className="rounded-full bg-blue-100 px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-blue-800">AI is replying</span>
                )}
              </span>
              <span className="font-normal normal-case">{ago(chat.last_message_at)}</span>
            </div>
            <p className="text-sm font-semibold truncate">{name}</p>
            {chat.last_message_preview && (
              <p className="text-sm text-muted-foreground line-clamp-2">&ldquo;{chat.last_message_preview}&rdquo;</p>
            )}
            <div className="mt-1 flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => view(chat)}>
                View
              </Button>
              <Button type="button" size="sm" disabled={busyId !== null} onClick={() => void accept(chat)}>
                ✓ Accept
              </Button>
            </div>
          </div>
        );
      })}
      {handled.map((chat) => (
        <div key={`gone-${chat.id}`} role="status" className="rounded-xl border bg-white/90 p-3 shadow-lg text-sm text-muted-foreground opacity-70 transition-opacity duration-500" data-chat-handled>
          <p className="font-semibold truncate text-foreground">{chat.contact_display_name || chat.contact_phone || "A visitor"}</p>
          <p>✓ This chat was taken care of</p>
        </div>
      ))}
      {extra > 0 && (
        <button
          type="button"
          onClick={() => router.push("/inbox")}
          className="self-end rounded-full border bg-white px-3 py-1 text-xs text-muted-foreground shadow"
          data-more-waiting
        >
          +{extra} more waiting · Open Inbox
        </button>
      )}
      <button type="button" onClick={toggleMute} className="self-end text-[11px] text-muted-foreground underline-offset-2 hover:underline" data-sound-toggle>
        {muted ? "Sound off · turn on" : "Sound on · mute"}
      </button>
    </div>
  );
}
