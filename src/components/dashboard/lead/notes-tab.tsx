"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { LeadNote } from "@/types/database";

interface NotesTabProps {
  leadId: string;
  notes: LeadNote[];
  onNotesChange: (notes: LeadNote[]) => void;
}

export interface NotesTabRef {
  focusComposer: () => void;
}

export const NotesTab = forwardRef<NotesTabRef, NotesTabProps>(
  function NotesTab({ leadId, notes, onNotesChange }, ref) {
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
              <NoteCard key={note.id} note={note} />
            ))}
          </div>
        )}
      </div>
    );
  }
);

function NoteCard({ note }: { note: LeadNote }) {
  const initials = getInitials(note.user_email);

  return (
    <Card className="shadow-none rounded-lg py-0">
      <CardContent className="p-4 pb-4">
        <div className="flex gap-3">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-medium text-primary">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{note.user_email}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatDateTime(note.created_at)}
              </span>
            </div>
            <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">
              {note.content}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function getInitials(email: string): string {
  const name = email.split("@")[0];
  const parts = name.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (diffDays === 1) {
    return "Yesterday at " + date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (diffDays < 7) {
    return `${diffDays} days ago`;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}
