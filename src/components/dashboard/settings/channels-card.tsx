"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { MessageSquare, Plus, Trash2, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface InboxChannel {
  id: string;
  provider: string;
  external_account_id: string;
  display_name: string;
  status: string;
  access_token_masked: string;
  webhook_url: string;
  verify_token: string;
  created_at: string;
}

interface ConnectResult {
  channel: { id: string; display_name: string; provider: string };
  webhook_url: string;
  verify_token: string;
}

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded bg-muted px-2 py-1.5 text-xs font-mono break-all">
          {value}
        </code>
        <Button size="sm" variant="ghost" className="h-7 w-7 shrink-0 p-0" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

export function ChannelsCard() {
  const router = useRouter();
  const [channels, setChannels] = useState<InboxChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InboxChannel | null>(null);
  const [successResult, setSuccessResult] = useState<ConnectResult | null>(null);

  const [form, setForm] = useState({ phone_number_id: "", access_token: "", display_name: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/inbox/channels");
      if (res.ok) {
        const json = await res.json() as { data: InboxChannel[] };
        setChannels(json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleConnect() {
    if (!form.phone_number_id || !form.access_token || !form.display_name) {
      toast.error("All fields are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/inbox/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "whatsapp",
          external_account_id: form.phone_number_id,
          access_token: form.access_token,
          display_name: form.display_name,
        }),
      });
      const json = await res.json() as { data?: ConnectResult; error?: string; message?: string };
      if (!res.ok) {
        const msg = json.message ?? json.error ?? "Failed to connect channel";
        toast.error(msg);
        return;
      }
      setConnectOpen(false);
      setForm({ phone_number_id: "", access_token: "", display_name: "" });
      setSuccessResult(json.data ?? null);
      await load();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/v1/inbox/channels/${deleteTarget.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(`${deleteTarget.display_name} disconnected`);
      setDeleteTarget(null);
      await load();
      router.refresh();
    } else {
      toast.error("Failed to disconnect channel");
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Messaging Channels
              </CardTitle>
              <CardDescription>
                Connect WhatsApp (and future channels) to receive and send messages in the Inbox.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setConnectOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Connect WhatsApp
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading channels…</p>
          ) : channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No channels connected yet. Click <strong>Connect WhatsApp</strong> to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {channels.map((ch) => (
                <div
                  key={ch.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{ch.display_name}</span>
                      <Badge
                        variant="secondary"
                        className={
                          ch.status === "active"
                            ? "bg-green-50 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }
                      >
                        {ch.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {ch.provider} · ID: {ch.external_account_id} · Token: {ch.access_token_masked}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(ch)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connect WhatsApp dialog */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect WhatsApp</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="phone_number_id">Phone Number ID</Label>
              <Input
                id="phone_number_id"
                placeholder="1234567890123"
                value={form.phone_number_id}
                onChange={(e) => setForm((f) => ({ ...f, phone_number_id: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Found in Meta Developer Portal → WhatsApp → API Setup
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="access_token">Access Token</Label>
              <Input
                id="access_token"
                type="password"
                placeholder="EAAxxxxxxxxxxxxxx"
                value={form.access_token}
                onChange={(e) => setForm((f) => ({ ...f, access_token: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Temporary (24h) or permanent System User token from Meta
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="display_name">Display Name</Label>
              <Input
                id="display_name"
                placeholder="e.g. Main WhatsApp"
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConnect} disabled={saving}>
              {saving ? "Connecting…" : "Connect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post-connect webhook info dialog */}
      <Dialog open={!!successResult} onOpenChange={(open) => { if (!open) setSuccessResult(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>WhatsApp connected ✓</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Paste these values into your Meta app under{" "}
              <strong>WhatsApp → Configuration → Webhook</strong>.
            </p>
            {successResult && (
              <>
                <CopyBox label="Callback URL" value={successResult.webhook_url} />
                <CopyBox label="Verify Token" value={successResult.verify_token} />
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Subscribe to the <strong>messages</strong> field after saving.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setSuccessResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {deleteTarget?.display_name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the channel and{" "}
            <strong>deletes all its conversations and messages</strong>. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
