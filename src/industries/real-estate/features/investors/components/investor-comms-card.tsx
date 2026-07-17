"use client";

import { useState } from "react";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AISparkleIcon } from "@/components/ui/ai-sparkle";

const NOTICE_TYPES = [
  { value: "distribution", label: "Distribution" },
  { value: "capital_call", label: "Capital Call" },
  { value: "quarterly_update", label: "Quarterly Update" },
] as const;

type NoticeType = (typeof NOTICE_TYPES)[number]["value"];

export function InvestorCommsCard({ leadId, canManage }: { leadId: string; canManage: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-1.5">
          <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Investor Comms
          </h3>
          <Badge
            variant="secondary"
            className="h-4 px-1 text-[10px] font-medium bg-purple-100 text-purple-700"
          >
            Beta
          </Badge>
        </div>
      </div>

      <div className="p-3">
        {canManage ? (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
            <AISparkleIcon className="size-4 mr-1.5" />
            Draft with AI ✨
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground py-1">
            Only admins can draft investor communications.
          </p>
        )}
      </div>

      {canManage && <DraftDialog leadId={leadId} open={open} onOpenChange={setOpen} />}
    </div>
  );
}

function DraftDialog({
  leadId,
  open,
  onOpenChange,
}: {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [type, setType] = useState<NoticeType>("distribution");
  const [draft, setDraft] = useState("");
  const [subject, setSubject] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/real-estate/comms/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, type }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to generate draft");
      }
      setDraft(json.data.draft as string);
      setSubject(json.data.subject as string);
    } catch (e) {
      setDraft("");
      setSubject("");
      setError(e instanceof Error ? e.message : "Failed to generate draft");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Failed to copy to clipboard");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <AISparkleIcon className="size-4" />
            Draft with AI
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <label className="text-xs text-muted-foreground">Notice type</label>
              <Select value={type} onValueChange={(v) => setType(v as NoticeType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NOTICE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={generate} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                  Generating…
                </>
              ) : (
                "Generate"
              )}
            </Button>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          {subject && <p className="text-xs text-muted-foreground">Subject: {subject}</p>}

          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Click Generate to produce a draft…"
            className="min-h-48 text-sm"
          />

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AISparkleIcon className="size-3 opacity-50" />
            <span>AI-generated draft · review before sending</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={!draft} onClick={copy}>
            {copied ? (
              <>
                <Check className="size-4 mr-1.5 text-green-600" />
                Copied!
              </>
            ) : (
              "Copy"
            )}
          </Button>
          <Button disabled title="Coming soon">
            Send (coming soon)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
