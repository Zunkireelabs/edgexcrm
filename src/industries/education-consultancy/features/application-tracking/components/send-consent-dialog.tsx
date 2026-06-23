"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Copy, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface SendConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  tenantId: string;
  defaultTab?: "send" | "manual";
  onSuccess: () => void;
}

export function SendConsentDialog({
  open,
  onOpenChange,
  leadId,
  tenantId,
  defaultTab = "send",
  onSuccess,
}: SendConsentDialogProps) {
  const [tab, setTab] = useState<"send" | "manual">(defaultTab);
  const [sending, setSending] = useState(false);
  const [sentLink, setSentLink] = useState<string | null>(null);
  const [sentVia, setSentVia] = useState<string | null>(null);

  // Manual tab state
  const [signerName, setSignerName] = useState("");
  const [signedAt, setSignedAt] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTab(defaultTab);
      setSentLink(null);
      setSentVia(null);
      setSignerName("");
      setSignedAt("");
      setDocumentUrl("");
    }
  }, [open, defaultTab]);

  async function handleSend() {
    setSending(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to send consent");
        return;
      }
      const { link, sent_via } = json.data as { link: string; sent_via: string };
      setSentLink(link);
      setSentVia(sent_via);
      if (sent_via === "email") {
        toast.success("Consent link sent via email");
      }
    } catch {
      toast.error("Failed to send consent");
    } finally {
      setSending(false);
    }
  }

  async function handleCopyLink() {
    if (!sentLink) return;
    try {
      await navigator.clipboard.writeText(sentLink);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  }

  async function handleFileUpload(file: File) {
    setUploading(true);
    try {
      // Step 1: get signed upload URL (mirrors public-form.tsx:298-309)
      const urlRes = await fetch("/api/v1/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || "application/octet-stream",
          field_name: "consent_document",
          session_id: "consent",
        }),
      });
      if (!urlRes.ok) { toast.error("Failed to get upload URL"); return; }
      const urlJson = await urlRes.json();
      const { path, token, public_url } = urlJson.data as { path: string; token: string; public_url: string };

      // Step 2: upload via Supabase storage (mirrors public-form.tsx:326-333)
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("lead-documents")
        .uploadToSignedUrl(path, token, file);
      if (uploadError) { toast.error("Upload failed"); return; }

      setDocumentUrl(public_url);
      toast.success("File uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleRecordManual() {
    if (!signerName.trim()) { toast.error("Signer name is required"); return; }
    if (!documentUrl) { toast.error("Please upload the signed consent document"); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record_manual",
          signer_name: signerName.trim(),
          document_url: documentUrl,
          signed_at: signedAt || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to record consent");
        return;
      }
      toast.success("Manual consent recorded");
      onSuccess();
    } catch {
      toast.error("Failed to record consent");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Student Consent</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b mb-4">
          <button
            type="button"
            onClick={() => setTab("send")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "send"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Send Link
          </button>
          <button
            type="button"
            onClick={() => setTab("manual")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === "manual"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Record Manually
          </button>
        </div>

        {tab === "send" && (
          <div className="space-y-4">
            {!sentLink ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Send the student a secure link to review and sign the consent document.
                </p>
                <Button onClick={handleSend} disabled={sending} className="w-full">
                  {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Send Consent Link
                </Button>
              </>
            ) : (
              <div className="space-y-3">
                {sentVia === "email" ? (
                  <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    Consent link sent via email.
                  </p>
                ) : (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    No email on file — share the link via WhatsApp or another channel.
                  </p>
                )}
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={sentLink}
                    className="flex-1 px-3 py-2 text-xs border rounded-lg bg-muted font-mono truncate"
                  />
                  <Button size="sm" variant="outline" onClick={handleCopyLink}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Button variant="outline" className="w-full" onClick={onSuccess}>
                  Done
                </Button>
              </div>
            )}
          </div>
        )}

        {tab === "manual" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a physically signed consent document and enter the signer&apos;s details.
            </p>

            <div className="space-y-1.5">
              <Label>Signer Name <span className="text-destructive">*</span></Label>
              <Input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Full name as signed"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Date Signed</Label>
              <Input
                type="date"
                value={signedAt}
                onChange={(e) => setSignedAt(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Signed Document <span className="text-destructive">*</span></Label>
              {documentUrl ? (
                <div className="flex items-center gap-2 p-2 border rounded-lg bg-muted/30">
                  <span className="text-xs text-green-700 flex-1 truncate">Document uploaded</span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setDocumentUrl("")}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-4 cursor-pointer hover:bg-muted/20 transition-colors">
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Click to upload PDF or image</span>
                    </>
                  )}
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                  />
                </label>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={handleRecordManual}
                disabled={saving || uploading || !signerName.trim() || !documentUrl}
                className="flex-1"
              >
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Record Consent
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
