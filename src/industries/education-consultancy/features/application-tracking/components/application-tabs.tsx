"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ApplicationActivityTimeline, formatTime } from "./application-activity-timeline";
import { uploadApplicantDocument } from "../../applicant-documents/upload-document";
import { NoteAddDocuments, NoteAttachmentPicker, NoteDocumentList, type NoteDocument } from "./note-attachment-ui";
import { ApplicationDocumentsList, type ApplicationDocument } from "./application-documents-list";
import { defaultAttachmentType, noteContentFor, type PendingAttachment } from "./note-attachments";
import type { LeadActivity } from "@/lib/supabase/queries";

interface ApplicationNote {
  id: string;
  application_id: string;
  user_id: string;
  user_email: string;
  content: string;
  created_at: string;
  documents?: NoteDocument[];
}

interface ApplicationTabsProps {
  applicationId: string;
  timeline: LeadActivity[];
  teamMemberEmails: Record<string, string>;
  teamMemberNames?: Record<string, string>;
  currentUserId: string;
  /** The student this application belongs to — documents are stored against the student. */
  leadId: string;
  /** May attach documents to notes (same people who can add notes). */
  canAttach?: boolean;
  /** The application's offer type, used to pre-select the document type. */
  offerType?: string | null;
  /** Owner/admin — may delete any file (anyone else only the files they uploaded). */
  isAdmin?: boolean;
}

type Tab = "activity" | "notes" | "documents" | "emails" | "calls" | "tasks" | "meetings";

const TABS: { id: Tab; label: string }[] = [
  { id: "activity", label: "Activity" },
  { id: "notes", label: "Notes" },
  { id: "documents", label: "Documents" },
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
  leadId,
  canAttach = false,
  offerType = null,
  isAdmin = false,
}: ApplicationTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("activity");
  const [notes, setNotes] = useState<ApplicationNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [docs, setDocs] = useState<ApplicationDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  // Set once the note is saved but some of its files failed: "retry" then uploads to THIS note, never a new one.
  const [savedNoteId, setSavedNoteId] = useState<string | null>(null);

  const fetchNotes = useCallback(async (silent = false) => {
    if (!silent) setLoadingNotes(true);
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

  // Every file on this application (the student's documents filtered to this application). Best effort: a
  // failed lookup just leaves the Documents tab empty — it never blocks the notes.
  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/documents`);
      if (!res.ok) return;
      const json = await res.json();
      const all = (json.data?.documents ?? []) as (ApplicationDocument & { application_id?: string | null })[];
      setDocs(all.filter((d) => d.application_id === applicationId));
    } catch {
      // keep whatever we had
    } finally {
      setLoadingDocs(false);
    }
  }, [leadId, applicationId]);

  useEffect(() => { fetchNotes(); fetchDocs(); }, [fetchNotes, fetchDocs]);

  // After any change to a file: refresh the notes (their chips) and the Documents tab together.
  const refreshFiles = useCallback(() => {
    fetchNotes(true);
    fetchDocs();
  }, [fetchNotes, fetchDocs]);

  function addFiles(files: File[]) {
    setPending((prev) => [
      ...prev,
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        type: defaultAttachmentType(offerType),
        name: "",
      })),
    ]);
  }

  async function handleAddNote() {
    const retrying = savedNoteId !== null;
    const content = noteContentFor(draft, pending);
    if (!retrying && !content) return;
    setSaving(true);
    try {
      let noteId = savedNoteId;
      if (!noteId) {
        // 1. Save the note first, so its id exists for the files to be attached to.
        const res = await fetch(`/api/v1/applications/${applicationId}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (!res.ok) throw new Error("Failed to add note");
        const { data } = await res.json();
        noteId = (data as ApplicationNote).id;
        setNotes((prev) => [{ ...(data as ApplicationNote), documents: [] }, ...prev]);
        setDraft("");
      }

      // 2. Upload each file through the safe flow (the record is only saved once the file is confirmed in storage).
      const failed: PendingAttachment[] = [];
      for (const item of pending) {
        const result = await uploadApplicantDocument({
          leadId,
          file: item.file,
          documentType: item.type,
          name: item.name,
          applicationId,
          applicationNoteId: noteId,
        });
        if (!result.ok) failed.push({ ...item, error: result.message });
      }
      setPending(failed);
      // Set together with the failed list (before the refresh below), so the retry state never lags the message.
      setSavedNoteId(failed.length > 0 ? noteId : null);
      if (pending.length > 0) await Promise.all([fetchNotes(true), fetchDocs()]);

      if (failed.length > 0) {
        toast.error(`Note saved, but ${failed.length} file${failed.length === 1 ? "" : "s"} did not upload. Retry below.`);
      } else {
        if (pending.length > 0) toast.success(retrying ? "Documents attached" : "Note added with documents");
      }
    } catch {
      toast.error("Failed to add note");
    } finally {
      setSaving(false);
    }
  }

  function discardFailedFiles() {
    setPending([]);
    setSavedNoteId(null);
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
              {tab.id === "documents" && docs.length > 0 && (
                <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] leading-none">
                  {docs.length}
                </Badge>
              )}
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
            {canAttach && (
              <NoteAttachmentPicker
                items={pending}
                disabled={saving}
                onAdd={addFiles}
                onChange={(id, patch) => setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch, error: undefined } : p)))}
                onRemove={(id) => setPending((prev) => prev.filter((p) => p.id !== id))}
              />
            )}
            {savedNoteId && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 flex items-center justify-between gap-2">
                <span>Your note was saved. {pending.length} file{pending.length === 1 ? "" : "s"} did not upload.</span>
                <button type="button" className="underline underline-offset-2 shrink-0" onClick={discardFailedFiles} disabled={saving}>
                  Discard files
                </button>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">⌘+Enter to save</span>
              <Button
                size="sm"
                onClick={handleAddNote}
                disabled={saving || (savedNoteId ? pending.length === 0 : !noteContentFor(draft, pending))}
              >
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {saving ? "Saving…" : savedNoteId ? `Retry upload (${pending.length})` : "Add Note"}
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
                  <NoteDocumentList
                    documents={note.documents ?? []}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                    canManage={canAttach}
                    onChanged={refreshFiles}
                  />
                  {canAttach && (
                    <NoteAddDocuments
                      noteId={note.id}
                      applicationId={applicationId}
                      leadId={leadId}
                      offerType={offerType}
                      onUploaded={refreshFiles}
                    />
                  )}
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {nameFor(note.user_id, note.user_email)} · {formatTime(note.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "documents" && (
        <ApplicationDocumentsList
          docs={docs}
          loading={loadingDocs}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          canManage={canAttach}
          onChanged={refreshFiles}
        />
      )}

      {activeTab === "emails" && <ComingSoon label="Emails" />}
      {activeTab === "calls" && <ComingSoon label="Calls" />}
      {activeTab === "tasks" && <ComingSoon label="Tasks" />}
      {activeTab === "meetings" && <ComingSoon label="Meetings" />}
    </div>
  );
}
