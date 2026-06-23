"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Clock, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { LeadNote } from "@/types/database";

interface MentionUser {
  user_id: string;
  name: string | null;
  email: string;
}

/** The label inserted/matched for a mention — real name when known, else email. */
function mentionLabel(u: MentionUser): string {
  return u.name || u.email;
}

interface NotesTabProps {
  leadId: string;
  notes: LeadNote[];
  onNotesChange: (notes: LeadNote[]) => void;
  teamMemberNames?: Record<string, string>;
  teamMemberEmails?: Record<string, string>;
  /** Auth user id of the viewer — own notes render chat-style on the right. */
  currentUserId?: string;
}

/** Resolve a note author's display name: real name → team email → stored email. */
function resolveAuthor(
  note: LeadNote,
  teamMemberNames: Record<string, string>,
  teamMemberEmails: Record<string, string>,
): string {
  return (
    teamMemberNames[note.user_id] ||
    teamMemberEmails[note.user_id] ||
    note.user_email
  );
}

export interface NotesTabRef {
  focusComposer: () => void;
}

export const NotesTab = forwardRef<NotesTabRef, NotesTabProps>(
  function NotesTab(
    { leadId, notes, onNotesChange, teamMemberNames = {}, teamMemberEmails = {}, currentUserId },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [newNote, setNewNote] = useState("");
    const [adding, setAdding] = useState(false);

    // @mention picker state
    const [mentionUsers, setMentionUsers] = useState<MentionUser[]>([]);
    const [mentionOpen, setMentionOpen] = useState(false);
    const [mentionQuery, setMentionQuery] = useState("");
    const [mentionStart, setMentionStart] = useState<number | null>(null);
    const [activeIdx, setActiveIdx] = useState(0);

    useImperativeHandle(ref, () => ({
      focusComposer: () => {
        textareaRef.current?.focus();
      },
    }));

    // Load the branch-scoped mentionable users for this lead.
    useEffect(() => {
      let cancelled = false;
      fetch(`/api/v1/leads/${leadId}/mentionable-users`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (!cancelled && json?.data) setMentionUsers(json.data as MentionUser[]);
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [leadId]);

    // Labels of all mentionable users — used to highlight @mentions in saved notes.
    const mentionLabels = useMemo(() => mentionUsers.map(mentionLabel), [mentionUsers]);

    const mentionMatches = useMemo(() => {
      const q = mentionQuery.trim().toLowerCase();
      const list = q
        ? mentionUsers.filter(
            (u) =>
              (u.name || "").toLowerCase().includes(q) ||
              u.email.toLowerCase().includes(q),
          )
        : mentionUsers;
      return list.slice(0, 6);
    }, [mentionUsers, mentionQuery]);

    // Detect an active "@query" right before the cursor (no spaces in the query,
    // so an already-inserted "@Full Name " never re-triggers the picker).
    const syncMentionState = (value: string, cursor: number) => {
      const upto = value.slice(0, cursor);
      const at = upto.lastIndexOf("@");
      if (at < 0) {
        setMentionOpen(false);
        return;
      }
      const charBefore = at > 0 ? upto[at - 1] : " ";
      const validStart = at === 0 || /\s/.test(charBefore);
      const query = upto.slice(at + 1);
      if (!validStart || /\s/.test(query) || query.length > 40) {
        setMentionOpen(false);
        return;
      }
      setMentionStart(at);
      setMentionQuery(query);
      setActiveIdx(0);
      setMentionOpen(true);
    };

    const selectMention = (u: MentionUser) => {
      if (mentionStart === null) return;
      const label = mentionLabel(u);
      const before = newNote.slice(0, mentionStart);
      const after = newNote.slice(mentionStart + 1 + mentionQuery.length);
      const inserted = `@${label} `;
      setNewNote(before + inserted + after);
      setMentionOpen(false);
      setMentionStart(null);
      setMentionQuery("");
      const caret = before.length + inserted.length;
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(caret, caret);
        }
      }, 0);
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setNewNote(value);
      syncMentionState(value, e.target.selectionStart ?? value.length);
    };

    const handleAddNote = async () => {
      const content = newNote.trim();
      if (!content) return;
      setAdding(true);

      try {
        // Which mentionable users are referenced as @Label in the text.
        const mentioned_user_ids = mentionUsers
          .filter((u) => content.includes(`@${mentionLabel(u)}`))
          .map((u) => u.user_id);

        const res = await fetch(`/api/v1/leads/${leadId}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, mentioned_user_ids }),
        });
        if (!res.ok) throw new Error("request failed");
        const json = await res.json();

        onNotesChange([json.data as LeadNote, ...notes]);
        setNewNote("");
        setMentionOpen(false);
        toast.success(
          mentioned_user_ids.length ? "Note added · people notified" : "Note added",
        );
      } catch {
        toast.error("Failed to add note");
      } finally {
        setAdding(false);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mentionOpen && mentionMatches.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIdx((i) => (i + 1) % mentionMatches.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIdx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          selectMention(mentionMatches[activeIdx]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMentionOpen(false);
          return;
        }
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleAddNote();
      }
    };

    return (
      <div className="space-y-4">
        {/* Note Composer */}
        <Card className="shadow-none rounded-lg py-0">
          <CardContent className="p-4 pb-4">
            <div className="space-y-3">
              <div className="relative">
                <Textarea
                  ref={textareaRef}
                  placeholder="Add a note... (type @ to mention)"
                  value={newNote}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  onBlur={() => setTimeout(() => setMentionOpen(false), 120)}
                  className="min-h-[100px] resize-none"
                />
                {mentionOpen && mentionMatches.length > 0 && (
                  <div className="absolute left-2 right-2 top-11 z-50 max-h-[150px] overflow-auto rounded-md border bg-popover shadow-lg">
                    {mentionMatches.map((u, i) => (
                      <button
                        type="button"
                        key={u.user_id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectMention(u);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                          i === activeIdx ? "bg-accent" : "hover:bg-accent"
                        }`}
                      >
                        <span className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium text-primary shrink-0">
                          {getInitials(u.name || u.email)}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate font-medium">{u.name || u.email}</span>
                          {u.name && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {u.email}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Type @ to mention · ⌘+Enter to save
                </p>
                <Button
                  size="sm"
                  onClick={handleAddNote}
                  disabled={adding || !newNote.trim()}
                >
                  <Send className="h-4 w-4 mr-2" />
                  {adding ? "Adding..." : "Add Note"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notes Timeline */}
        {notes.length === 0 ? (
          <Card className="shadow-none rounded-lg py-0">
            <CardContent className="p-8 pb-8 text-center">
              <p className="text-muted-foreground">No notes yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add the first note above
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                teamMemberNames={teamMemberNames}
                teamMemberEmails={teamMemberEmails}
                currentUserId={currentUserId}
                mentionLabels={mentionLabels}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
);

function NoteCard({
  note,
  teamMemberNames,
  teamMemberEmails,
  currentUserId,
  mentionLabels,
}: {
  note: LeadNote;
  teamMemberNames: Record<string, string>;
  teamMemberEmails: Record<string, string>;
  currentUserId?: string;
  mentionLabels: string[];
}) {
  const authorName = resolveAuthor(note, teamMemberNames, teamMemberEmails);
  const initials = getInitials(authorName);
  // Chat-style: the viewer's own notes sit on the right (mirrored + tinted);
  // everyone else's stay on the left exactly as before.
  const isOwn = !!currentUserId && note.user_id === currentUserId;

  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
      <Card
        className={`shadow-none rounded-lg py-0 max-w-[80%] ${
          isOwn ? "bg-primary/5 border-primary/20" : ""
        }`}
      >
        <CardContent className="p-4 pb-4">
          <div className={`flex gap-3 ${isOwn ? "flex-row-reverse" : ""}`}>
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-xs font-medium text-primary">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className={`flex items-center ${isOwn ? "justify-end" : "justify-start"}`}>
                <span className="text-sm font-medium truncate">{authorName}</span>
              </div>
              <p
                className={`text-sm text-foreground mt-1 whitespace-pre-wrap ${
                  isOwn ? "text-right" : ""
                }`}
              >
                {renderWithMentions(note.content, mentionLabels)}
              </p>
              {/* Exact date + time — always visible, aligned to the bubble side */}
              <div
                className={`mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground/70 ${
                  isOwn ? "justify-end" : "justify-start"
                }`}
              >
                <Clock className="h-3 w-3 shrink-0" />
                <span>{formatExactStamp(note.created_at)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function getInitials(nameOrEmail: string): string {
  // For an email, derive from the local-part; for a real name, from the words.
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail;
  const parts = base.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return base.substring(0, 2).toUpperCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Render note text, wrapping any "@<known member>" as a styled mention chip. */
function renderWithMentions(content: string, labels: string[]): React.ReactNode {
  const known = [...new Set(labels.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (known.length === 0) return content;

  const re = new RegExp(`@(${known.map(escapeRegExp).join("|")})`, "g");
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) out.push(content.slice(last, m.index));
    out.push(
      <span
        key={key++}
        className="rounded bg-primary/10 px-1 font-medium text-primary"
      >
        @{m[1]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < content.length) out.push(content.slice(last));
  return out;
}

// Visible exact stamp: "Jun 23, 2026 · 2:42 PM".
function formatExactStamp(dateString: string): string {
  const d = new Date(dateString);
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}
