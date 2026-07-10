"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ApplicationActivityTimeline, formatTime } from "./application-activity-timeline";
import type { LeadActivity } from "@/lib/supabase/queries";

interface ApplicationNote {
  id: string;
  application_id: string;
  user_id: string;
  user_email: string;
  content: string;
  created_at: string;
}

interface ApplicationTabsProps {
  applicationId: string;
  timeline: LeadActivity[];
  teamMemberEmails: Record<string, string>;
  teamMemberNames?: Record<string, string>;
  currentUserId: string;
}

type Tab = "activity" | "notes" | "emails" | "calls" | "tasks" | "meetings";

const TABS: { id: Tab; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "notes", label: "Notes" },
  { id: "emails", label: "Emails" },
  { id: "calls", label: "Calls" },
  { id: "tasks", label: "Tasks" },
  { id: "meetings", label: "Meetings" },
];

function ComingSoon({ label }: { label: string }) {
  return (
    <p className="text-sm text-muted-foreground text-center py-10">
      {label} isn&apos;t available on applications yet — coming in a future update.
    </p>
  );
}

export function ApplicationTabs({
  applicationId,
  timeline,
  teamMemberEmails,
  teamMemberNames = {},
  currentUserId,
}: ApplicationTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("activity");
  const [notes, setNotes] = useState<ApplicationNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchNotes = useCallback(async () => {
    setLoadingNotes(true);
    try {
      const res = await fetch(`/api/v1/applications/${applicationId}/notes`);
      if (res.ok) {
        const json = await res.json();
        setNotes(json.data ?? []);
      }
    } catch {
      toast.error("Failed to load notes");
    } finally {
      setLoadingNotes(false);
    }
  }, [applicationId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  async function handleAddNote() {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/applications/${applicationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Failed to add note");
      const { data } = await res.json();
      setNotes((prev) => [data as ApplicationNote, ...prev]);
      setDraft("");
    } catch {
      toast.error("Failed to add note");
    } finally {
      setSaving(false);
    }
  }

  function nameFor(userId: string, email: string) {
    if (userId === currentUserId) return "you";
    return teamMemberNames[userId] || teamMemberEmails[userId] || email;
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs — same underline style as the Lead Detail Activity panel */}
      <div className="border-b">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.id === "notes" && notes.length > 0 && (
                <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] leading-none">
                  {notes.length}
                </Badge>
              )}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "activity" && (
        <ApplicationActivityTimeline timeline={timeline} teamMemberEmails={teamMemberEmails} />
      )}

      {activeTab === "notes" && (
        <div className="space-y-3">
          <div className="border rounded-lg p-3 space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a note..."
              rows={3}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleAddNote();
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">⌘+Enter to save</span>
              <Button size="sm" onClick={handleAddNote} disabled={saving || !draft.trim()}>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {saving ? "Saving…" : "Add Note"}
              </Button>
            </div>
          </div>

          {loadingNotes ? (
            <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No notes yet.</p>
          ) : (
            <div className="space-y-2">
              {notes.map((note) => (
                <div key={note.id} className="border rounded-lg p-3">
                  <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {nameFor(note.user_id, note.user_email)} · {formatTime(note.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "emails" && <ComingSoon label="Emails" />}
      {activeTab === "calls" && <ComingSoon label="Calls" />}
      {activeTab === "tasks" && <ComingSoon label="Tasks" />}
      {activeTab === "meetings" && <ComingSoon label="Meetings" />}
    </div>
  );
}
