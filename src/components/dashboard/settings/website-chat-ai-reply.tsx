"use client";

// "AI replies" part of the Website chat card (Admizz only). The Admizz AI answers visitors until a counsellor accepts the chat.
// Hidden unless the server is set up for it and this tenant is allowed (the card's GET says so in `aiReply.available`).

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const API_PATH = "/api/v1/inbox/website-chat/ai-reply";

export interface AiReplyInitial {
  available: boolean;
  enabled: boolean;
  siteId: string;
}

export function WebsiteChatAiReply({ initial }: { initial?: AiReplyInitial }) {
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [siteId, setSiteId] = useState(initial?.siteId ?? "");
  const [busy, setBusy] = useState(false);

  if (!initial?.available) return null;

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch(API_PATH, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, siteId }) });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = Object.values(json?.error?.details ?? {}).flat()[0] as string | undefined;
        throw new Error(detail ?? json?.error?.message ?? "Could not save AI replies");
      }
      toast.success("AI replies saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save AI replies");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t pt-4" data-ai-replies>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">AI replies</h3>
          <p className="text-xs text-muted-foreground">
            The Admizz AI answers visitors right away. When an assignee clicks Accept, the AI stops. If it can&apos;t answer, or the visitor asks
            for a person, it tells them someone will reply and marks the chat &ldquo;Needs a human&rdquo;.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="AI replies" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ai-site-id" className="text-xs">Admizz AI site ID</Label>
        <Input id="ai-site-id" value={siteId} onChange={(e) => setSiteId(e.target.value)} placeholder="the site ID from the Admizz AI" />
      </div>
      <Button size="sm" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Save AI replies"}
      </Button>
    </div>
  );
}
