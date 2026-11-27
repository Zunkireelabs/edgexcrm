"use client";

import { useState, useEffect } from "react";
import { CircleNotchIcon } from "@/components/icons";
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
import { useCompanySender } from "../hooks/use-company-sender";
import { COMPANY_SENDER_ID, NO_REPLY_SENDER_ID } from "@/lib/email/company-sender-id";
import { brandedFooterHtml, brandedHeaderHtml, renderBrandedMessage } from "@/lib/email/template/branded-message";
import { ComposeEmailPreviewDialog } from "./compose-email-preview-dialog";
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

/**
 * Fills {{first_name}} / {{last_name}} the same way the server does when the email is sent, so the Preview matches. A name
 * that is not known here (undefined) leaves the tag as typed; a known-but-empty one (null) becomes "", like the server.
 */
export function fillLeadTokens(text: string, first?: string | null, last?: string | null): string {
  let out = text;
  if (first !== undefined) out = out.replace(/\{\{\s*first_name\s*\}\}/g, first ?? "");
  if (last !== undefined) out = out.replace(/\{\{\s*last_name\s*\}\}/g, last ?? "");
  return out;
}

/**
 * Which "From" a reply must use: the thread's own Gmail account, or — for a thread that was
 * started from the company address (no Gmail account, with an outbound message sent via
 * Resend) — the company sender. Anything else (e.g. a personal BCC-dropbox thread) has no
 * valid sender here and returns "", which keeps Send disabled exactly as before.
 */
export function replyFromAccountId(thread: EmailThread): string {
  if (thread.connected_email_account_id) return thread.connected_email_account_id;
  const startedFromCompany = thread.emails.some((e) => e.direction === "outbound" && e.provider === "resend");
  return startedFromCompany ? COMPANY_SENDER_ID : "";
}

export function ComposeEmailDialog({
  open,
  onOpenChange,
  defaultTo,
  defaultSubject,
  leadId,
  contactId,
  leadFirstName,
  leadLastName,
  currentUserId = "",
  replyContext,
  onSent,
}: ComposeEmailDialogProps) {
  const { inboxes, loading: inboxesLoading } = useConnectedInboxes();
  const { companySender, loading: companyLoading } = useCompanySender();

  // Everything the user may send FROM: their own connected Gmail accounts first, then the
  // company address (when the tenant has a verified one) — so someone with no Gmail connected
  // can still send, and someone with Gmail keeps it as the default.
  // The no-reply address (when an admin set it up) comes last, so it is never the default, and only for a NEW email: a reply
  // always goes from the company address.
  const noReply = companySender?.no_reply ?? null;
  const senders = [
    ...inboxes.map((i) => ({ id: i.id, email: i.email, display_name: i.display_name })),
    ...(companySender
      ? [{ id: COMPANY_SENDER_ID, email: companySender.email, display_name: companySender.display_name }]
      : []),
    ...(noReply && !replyContext ? [{ id: NO_REPLY_SENDER_ID, email: noReply.email, display_name: noReply.display_name }] : []),
  ];

  const [fromAccountId, setFromAccountId] = useState("");
  const [to, setTo] = useState(defaultTo ?? "");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(defaultSubject ?? "");
  const [bodyHtml, setBodyHtml] = useState("");
  const [sending, setSending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const isReply = !!replyContext;

  // Sync fields when dialog opens (fresh compose) or replyContext changes
  useEffect(() => {
    if (open) {
      if (replyContext) {
        setFromAccountId(replyFromAccountId(replyContext.thread));
        setTo(replyContext.lastMessage.from_email);
        setSubject(buildReplySubject(replyContext.lastMessage.subject));
        setBodyHtml("");
      } else {
        setTo(defaultTo ?? "");
        setSubject(defaultSubject ?? "");
        setBodyHtml("");
        // The no-reply choice is never sticky: a new email starts from the usual default again.
        setFromAccountId((cur) => (cur === NO_REPLY_SENDER_ID ? "" : cur));
      }
    }
  }, [open, defaultTo, defaultSubject, replyContext]);

  // Pre-select the first sender (fresh compose only) — but only once BOTH lists have loaded. The two
  // requests race; choosing early would lock in the company address for someone whose Gmail simply
  // hadn't arrived yet, instead of defaulting to their own inbox.
  const firstSenderId = senders[0]?.id ?? "";
  const sendersLoaded = !inboxesLoading && !companyLoading;
  useEffect(() => {
    if (!isReply && sendersLoaded && firstSenderId && !fromAccountId) {
      setFromAccountId(firstSenderId);
    }
  }, [sendersLoaded, firstSenderId, fromAccountId, isReply]);

  // The chosen sender must actually be available (a company reply needs the company address to still exist).
  const hasSender = senders.some((s) => s.id === fromAccountId);
  // The branded layout applies only while the no-reply address is the chosen sender of a new email.
  const isNoReply = !isReply && fromAccountId === NO_REPLY_SENDER_ID && !!noReply;
  const canSend =
    hasSender &&
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
      const selectedInbox = senders.find((i) => i.id === fromAccountId);
      const now = new Date().toISOString();
      const optimisticEmail: Email = {
        id: email_id,
        direction: "outbound",
        // 'resend' marks a company-sender message so an immediate Reply on it picks the company sender
        ...(fromAccountId === COMPANY_SENDER_ID || fromAccountId === NO_REPLY_SENDER_ID ? { provider: "resend" } : {}),
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

  // The finished email for the Preview, built only while it is open: the very same function the server uses when it sends.
  const previewHtml =
    previewOpen && isNoReply && noReply
      ? renderBrandedMessage({
          bodyHtml: fillLeadTokens(bodyHtml, leadFirstName, leadLastName),
          brand: noReply.brand,
          title: fillLeadTokens(subject, leadFirstName, leadLastName),
        })
      : "";

  const resetForm = () => {
    setTo(defaultTo ?? "");
    setCc("");
    setBcc("");
    setSubject(defaultSubject ?? "");
    setBodyHtml("");
    setShowCcBcc(false);
  };

  // Locked "From" display for reply mode
  const lockedInbox = isReply ? senders.find((i) => i.id === replyFromAccountId(replyContext.thread)) : null;
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
            ) : !inboxesLoading && !companyLoading && senders.length === 0 ? (
              // Nothing to send from: say so (and how to fix it) instead of a dead, greyed-out box
              <p className="text-sm text-muted-foreground rounded-md border border-dashed px-3 py-2">
                No sending address yet. Connect your Gmail in Settings → Communications, or ask an admin to
                verify the company email address there.
              </p>
            ) : (
              // Fresh compose: full picker
              <Select
                value={fromAccountId || firstSenderId}
                onValueChange={setFromAccountId}
                disabled={senders.length <= 1}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select inbox…" />
                </SelectTrigger>
                <SelectContent>
                  {senders.map((inbox) => (
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
            {/* With the no-reply address the message sits inside the company layout: a fixed logo + colour bar above it and a
                fixed footer below it, drawn from the same pieces the sent email is built from. The editor keeps the same place
                in the tree either way, so switching sender never resets what was typed. */}
            <div
              data-testid={isNoReply ? "no-reply-frame" : undefined}
              className={isNoReply ? "overflow-hidden rounded-md border bg-white" : undefined}
            >
              {isNoReply && noReply && (
                <div
                  data-testid="template-header"
                  aria-hidden
                  className="pointer-events-none select-none"
                  dangerouslySetInnerHTML={{ __html: brandedHeaderHtml(noReply.brand) }}
                />
              )}
              <div className={isNoReply ? "border-y border-dashed border-blue-400/70" : undefined}>
                <TipTapEditor value={bodyHtml} onChange={setBodyHtml} minHeight={200} />
              </div>
              {isNoReply && noReply && (
                <div
                  data-testid="template-footer"
                  aria-hidden
                  className="pointer-events-none select-none"
                  dangerouslySetInnerHTML={{ __html: brandedFooterHtml(noReply.brand) }}
                />
              )}
            </div>
          </div>

          {isNoReply && (
            <p className="text-xs text-muted-foreground">
              Sent with the company layout: the logo and footer are added for you. Use Preview to see the finished email.
            </p>
          )}

          {!isReply && (
            <p className="text-xs text-muted-foreground">
              Use <code className="text-xs">{"{{first_name}}"}</code> and{" "}
              <code className="text-xs">{"{{last_name}}"}</code> to personalize
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          {isNoReply && (
            <Button variant="outline" onClick={() => setPreviewOpen(true)}>
              Preview
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={!canSend || sending}>
            {sending && <CircleNotchIcon className="h-4 w-4 mr-2 animate-spin" />}
            Send
          </Button>
        </div>
      </DialogContent>

      {isNoReply && noReply && (
        <ComposeEmailPreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          subject={fillLeadTokens(subject, leadFirstName, leadLastName)}
          from={`${noReply.display_name} <${noReply.email}>`}
          replyTo={noReply.brand.helpEmail}
          html={previewHtml}
        />
      )}
    </Dialog>
  );
}
