"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { LeadNote } from "@/types/database";

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

    useImperativeHandle(ref, () => ({
      focusComposer: () => {
        textareaRef.current?.focus();
      },
    }));

    const handleAddNote = async () => {
      if (!newNote.trim()) return;
      setAdding(true);

      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        const { data, error } = await supabase
          .from("lead_notes")
          .insert({
            lead_id: leadId,
            user_id: user!.id,
            user_email: user!.email!,
            content: newNote.trim(),
          })
          .select()
          .single();

        if (error) throw error;

        onNotesChange([data as LeadNote, ...notes]);
        setNewNote("");
        toast.success("Note added");
      } catch {
        toast.error("Failed to add note");
      } finally {
        setAdding(false);
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
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
              <Textarea
                ref={textareaRef}
                placeholder="Add a note..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                onKeyDown={handleKeyDown}
                className="min-h-[100px] resize-none"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Press ⌘+Enter to save
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
}: {
  note: LeadNote;
  teamMemberNames: Record<string, string>;
  teamMemberEmails: Record<string, string>;
  currentUserId?: string;
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
              <div
                className={`flex items-center justify-between gap-2 ${
                  isOwn ? "flex-row-reverse" : ""
                }`}
              >
                <span className="text-sm font-medium truncate">{authorName}</span>
                <span
                  className="text-xs text-muted-foreground shrink-0"
                  title={formatAbsolute(note.created_at)}
                >
                  {formatRelativeTime(note.created_at)}
                </span>
              </div>
              <p
                className={`text-sm text-foreground mt-1 whitespace-pre-wrap ${
                  isOwn ? "text-right" : ""
                }`}
              >
                {note.content}
              </p>
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

// Relative time for the note timestamp ("Just now" / "5m ago" / "3h ago" /
// "Yesterday" / "2d ago" / "Jun 16"). Mirrors formatRelativeTime used by the
// Overview preview and Activity notes sub-tab so all three sites match.
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return diffMinutes <= 1 ? "Just now" : `${diffMinutes}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

// Full, exact timestamp shown on hover via the title tooltip
// (e.g. "Jun 23, 2026, 12:09 PM").
function formatAbsolute(dateString: string): string {
  return new Date(dateString).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
