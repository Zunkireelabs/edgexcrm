"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { TipTapEditor } from "./tiptap-editor";
import { useConnectedInboxes } from "../hooks/use-connected-inboxes";
import type { EmailThread, Email } from "../hooks/use-email-threads";

interface ComposeEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTo?: string;
  defaultSubject?: string;
  leadId?: string;
  contactId?: string;
  leadFirstName?: string | null;
  leadLastName?: string | null;
  currentUserId?: string;
  replyContext?: {
    thread: EmailThread;
    lastMessage: Email;
  };
  onSent: (result: { thread_id: string; email_id: string }, optimisticEmail: Email) => void;
}

function buildReplySubject(subject: string): string {
  if (/^re:/i.test(subject.trim())) return subject.trim();
  return `Re: ${subject}`;
}

function buildReferencesChain(rfc_references: string[], rfc_message_id: string | null): string[] {
  const chain = [...rfc_references];
  if (rfc_message_id && !chain.includes(rfc_message_id)) {
    chain.push(rfc_message_id);
  }
  return chain;
}

export function ComposeEmailDialog({
  open,
  onOpenChange,
  defaultTo,
  defaultSubject,
  leadId,
  contactId,
  currentUserId = "",
  replyContext,
  onSent,
}: ComposeEmailDialogProps) {
  const { inboxes } = useConnectedInboxes();

  const [fromAccountId, setFromAccountId] = useState("");
  const [to, setTo] = useState(defaultTo ?? "");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(defaultSubject ?? "");
  const [bodyHtml, setBodyHtml] = useState("");
  const [sending, setSending] = useState(false);

  const isReply = !!replyContext;

  // Sync fields when dialog opens (fresh compose) or replyContext changes
  useEffect(() => {
    if (open) {
      if (replyContext) {
        setFromAccountId(replyContext.thread.connected_email_account_id);
        setTo(replyContext.lastMessage.from_email);
        setSubject(buildReplySubject(replyContext.lastMessage.subject));
        setBodyHtml("");
      } else {
        setTo(defaultTo ?? "");
        setSubject(defaultSubject ?? "");
        setBodyHtml("");
      }
    }
  }, [open, defaultTo, defaultSubject, replyContext]);

  // Pre-select first inbox when inboxes load (fresh compose only)
  useEffect(() => {
    if (!isReply && inboxes.length > 0 && !fromAccountId) {
      setFromAccountId(inboxes[0].id);
    }
  }, [inboxes, fromAccountId, isReply]);

  const hasInbox = inboxes.length > 0;
  const canSend =
    hasInbox &&
    fromAccountId &&
    to.trim() !== "" &&
    subject.trim() !== "" &&
    bodyHtml.trim() !== "" &&
    bodyHtml !== "<p></p>";

  const parseEmails = (s: string): string[] =>
    s
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

  const handleSend = async () => {
    setSending(true);
    try {
      const replyReferences = replyContext
        ? buildReferencesChain(
            replyContext.lastMessage.rfc_references,
            replyContext.lastMessage.rfc_message_id,
          )
        : [];

      const payload: Record<string, unknown> = {
        from_account_id: fromAccountId,
        to: parseEmails(to),
        cc: parseEmails(cc),
        bcc: parseEmails(bcc),
        subject: subject.trim(),
        body_html: bodyHtml,
        lead_id: isReply ? (replyContext.thread.lead_id ?? leadId) : leadId,
        contact_id: isReply ? (replyContext.thread.contact_id ?? contactId) : contactId,
      };

      if (isReply) {
        payload.reply_context = {
          thread_id: replyContext.thread.id,
          in_reply_to: replyContext.lastMessage.rfc_message_id,
          references: replyReferences,
        };
      }

      const res = await fetch("/api/v1/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      if (!res.ok) {
        const msg = json?.error?.message ?? "Failed to send email";
        toast.error(msg);
        return; // keep modal open, form intact
      }

      const { thread_id, email_id } = json.data;

      // Build optimistic email in the Email shape (for use-email-threads)
      const selectedInbox = inboxes.find((i) => i.id === fromAccountId);
      const now = new Date().toISOString();
      const optimisticEmail: Email = {
        id: email_id,
        direction: "outbound",
        from_email: selectedInbox?.email ?? "",
        from_name: selectedInbox?.display_name ?? null,
        to_emails: parseEmails(to),
        cc_emails: parseEmails(cc),
        subject: subject.trim(),
        body_html: bodyHtml,
        sent_at: now,
        received_at: null,
        read_at: null,
        sender_user_id: currentUserId,
        in_reply_to: isReply ? replyContext.lastMessage.rfc_message_id : null,
        rfc_references: replyReferences,
        rfc_message_id: null, // server-generated; not available optimistically
        gmail_message_id: "",  // not available optimistically
      };

      toast.success(`Email sent to ${parseEmails(to).join(", ")}`);
      onSent({ thread_id, email_id }, optimisticEmail);
      onOpenChange(false);
      resetForm();
    } finally {
      setSending(false);
    }
  };

  const resetForm = () => {
    setTo(defaultTo ?? "");
    setCc("");
    setBcc("");
    setSubject(defaultSubject ?? "");
    setBodyHtml("");
    setShowCcBcc(false);
  };

  // Locked "From" display for reply mode
  const lockedInbox = isReply
    ? inboxes.find((i) => i.id === replyContext.thread.connected_email_account_id)
    : null;
  const lockedFromLabel = lockedInbox
    ? (lockedInbox.display_name ? `${lockedInbox.display_name} <${lockedInbox.email}>` : lockedInbox.email)
    : "Loading…";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isReply ? "Reply" : "New email"}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          {/* From */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">From</Label>
            {isReply ? (
              // Reply mode: locked to the thread's account
              <Select value={fromAccountId} disabled>
                <SelectTrigger>
                  <SelectValue placeholder={lockedFromLabel} />
                </SelectTrigger>
                <SelectContent>
                  {lockedInbox && (
                    <SelectItem value={lockedInbox.id}>{lockedFromLabel}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            ) : (
              // Fresh compose: full picker
              <Select
                value={fromAccountId || (inboxes[0]?.id ?? "")}
                onValueChange={setFromAccountId}
                disabled={inboxes.length <= 1}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select inbox…" />
                </SelectTrigger>
                <SelectContent>
                  {inboxes.map((inbox) => (
                    <SelectItem key={inbox.id} value={inbox.id}>
                      {inbox.display_name ? `${inbox.display_name} <${inbox.email}>` : inbox.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* To */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">To</Label>
              {!isReply && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCcBcc((v) => !v)}
                >
                  Cc Bcc
                </button>
              )}
            </div>
            <Input
              placeholder="recipient@example.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              readOnly={isReply}
              className={isReply ? "bg-muted/50 cursor-default" : ""}
            />
          </div>

          {/* Cc / Bcc (fresh compose only) */}
          {!isReply && showCcBcc && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Cc</Label>
                <Input
                  placeholder="cc@example.com"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Bcc</Label>
                <Input
                  placeholder="bcc@example.com"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Subject */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Subject</Label>
            <Input
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              readOnly={isReply}
              className={isReply ? "bg-muted/50 cursor-default" : ""}
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Message</Label>
            <TipTapEditor value={bodyHtml} onChange={setBodyHtml} minHeight={200} />
          </div>

          {!isReply && (
            <p className="text-xs text-muted-foreground">
              Use <code className="text-xs">{"{{first_name}}"}</code> and{" "}
              <code className="text-xs">{"{{last_name}}"}</code> to personalize
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={!canSend || sending}>
            {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Send
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
