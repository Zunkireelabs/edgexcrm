"use client";

import { useState } from "react";
import { Mail, Phone, Calendar, MessageSquare, Clock, Loader2, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { Lead, UserRole } from "@/types/database";

interface CheckInRecord {
  id: string;
  content: string;
  created_at: string;
  user_email: string;
}

interface ContactsPageProps {
  leads: Lead[];
  role: UserRole;
  tenantId: string;
}

export function ContactsPage({ leads, role: _role, tenantId: _tenantId }: ContactsPageProps) {
  const [selectedContact, setSelectedContact] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<{ id: string; content: string; created_at: string }[]>([]);
  const [checkIns, setCheckIns] = useState<CheckInRecord[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const handleSelectContact = async (lead: Lead) => {
    setSelectedContact(lead);
    setNewNote("");
    setNotes([]);
    setCheckIns([]);
    setLoadingNotes(true);
    try {
      const [notesRes, checkInsRes] = await Promise.all([
        fetch(`/api/v1/leads/${lead.id}/notes`),
        fetch(`/api/v1/leads/${lead.id}/check-ins`),
      ]);
      const notesJson = await notesRes.json();
      const checkInsJson = await checkInsRes.json();
      if (notesJson.data) setNotes(notesJson.data);
      if (checkInsJson.data) setCheckIns(checkInsJson.data);
    } catch {
      toast.error("Failed to load contact details");
    } finally {
      setLoadingNotes(false);
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedContact) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/v1/leads/${selectedContact.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newNote.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error("Failed to save note"); return; }
      setNotes((prev) => [json.data, ...prev]);
      setNewNote("");
      toast.success("Note added");
    } catch {
      toast.error("Failed to save note");
    } finally {
      setSavingNote(false);
    }
  };

  const fullName = (lead: Lead) =>
    [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email || "Unknown";

  return (
    <div className="flex h-full min-h-0 gap-0">
      {/* Contact list */}
      <div className={`flex flex-col h-full ${selectedContact ? "w-[340px] shrink-0 border-r" : "flex-1"}`}>
        <div className="shrink-0 p-4 border-b">
          <h1 className="text-lg font-bold">Contacts</h1>
          <p className="text-sm text-muted-foreground">Walk-in visitors tagged as Other</p>
        </div>

        {leads.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div>
              <p className="text-muted-foreground">No contacts yet.</p>
              <p className="text-sm text-muted-foreground mt-1">Walk-in visitors tagged as &quot;Other&quot; will appear here.</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedContact?.id === lead.id ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/60"
                }`}
                onClick={() => handleSelectContact(lead)}
              >
                <div className="h-9 w-9 rounded-full bg-amber-100 flex items-center justify-center text-sm font-semibold text-amber-700 shrink-0">
                  {(lead.first_name?.[0] || lead.email?.[0] || "?").toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{fullName(lead)}</p>
                  <p className="text-xs text-muted-foreground truncate">{lead.email || lead.phone || "No contact info"}</p>
                </div>
                <div className="shrink-0 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span>{new Date(lead.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  <ChevronRight className="h-3 w-3" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedContact && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <div className="shrink-0 p-5 border-b">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center text-lg font-bold text-amber-700 shrink-0">
                {(selectedContact.first_name?.[0] || selectedContact.email?.[0] || "?").toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-semibold">{fullName(selectedContact)}</h2>
                <Badge variant="secondary" className="mt-1 text-[10px] bg-amber-50 text-amber-700">Other</Badge>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {selectedContact.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{selectedContact.email}</span>
                </div>
              )}
              {selectedContact.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{selectedContact.phone}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4 shrink-0" />
                <span>Added {new Date(selectedContact.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Check-in History */}
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4" />
                Check-in History
                {checkIns.length > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-xs">{checkIns.length}</Badge>
                )}
              </h3>
              {loadingNotes ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : checkIns.length === 0 ? (
                <p className="text-sm text-muted-foreground">No check-ins recorded.</p>
              ) : (
                <div className="space-y-2">
                  {checkIns.map((ci) => {
                    const noteText = (() => {
                      const dashIdx = ci.content.indexOf(" — ");
                      return dashIdx !== -1 ? ci.content.slice(dashIdx + 3).trim() : "";
                    })();
                    return (
                      <Card key={ci.id} className="bg-muted/30">
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-medium">
                                {new Date(ci.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                <span className="text-muted-foreground font-normal ml-1">
                                  {new Date(ci.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">By {ci.user_email}</p>
                              {noteText && <p className="text-xs mt-1 text-muted-foreground">{noteText}</p>}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <MessageSquare className="h-4 w-4" />
                Notes
              </h3>

              <Card className="mb-3">
                <CardContent className="p-3 space-y-2">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Add a note..."
                    className="min-h-[70px] resize-none text-sm"
                  />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={handleAddNote} disabled={savingNote || !newNote.trim()}>
                      {savingNote ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Save Note
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {!loadingNotes && notes.length === 0 && (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              )}
              <div className="space-y-2">
                {notes.map((note) => (
                  <Card key={note.id} className="bg-muted/30">
                    <CardContent className="p-3">
                      <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        {new Date(note.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
