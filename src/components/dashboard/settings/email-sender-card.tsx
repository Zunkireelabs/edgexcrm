"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Mail } from "lucide-react";
import { toast } from "sonner";

interface EmailSenderSettings {
  from_name: string | null;
  from_address: string | null;
  reply_to: string | null;
  domain_verified: boolean;
  updated_at: string | null;
}

export function EmailSenderCard() {
  const [settings, setSettings] = useState<EmailSenderSettings>({
    from_name: null,
    from_address: null,
    reply_to: null,
    domain_verified: false,
    updated_at: null,
  });
  const [form, setForm] = useState({ from_name: "", from_address: "", reply_to: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/settings/email-sender")
      .then((r) => r.json())
      .then((json) => {
        const d: EmailSenderSettings = json.data;
        setSettings(d);
        setForm({
          from_name: d.from_name ?? "",
          from_address: d.from_address ?? "",
          reply_to: d.reply_to ?? "",
        });
      })
      .catch(() => toast.error("Failed to load email sender settings"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/settings/email-sender", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_name: form.from_name || null,
          from_address: form.from_address || null,
          reply_to: form.reply_to || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const firstError = Object.values(json.errors ?? {}).flat()[0] as string | undefined;
        toast.error(firstError ?? "Failed to save settings");
        return;
      }
      setSettings(json.data);
      toast.success("Email sender settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="border rounded-lg p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Email Sender Identity</h2>
        {settings.domain_verified ? (
          <Badge variant="default" className="ml-auto bg-green-100 text-green-700 border-green-200">
            Verified — sending from your domain
          </Badge>
        ) : (
          <Badge variant="secondary" className="ml-auto">
            Pending verification — sending as your name from EdgeX, replies go to you
          </Badge>
        )}
      </div>

      <div className="grid gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="email-sender-name">Display name</Label>
          <Input
            id="email-sender-name"
            placeholder="e.g. Admizz Education"
            value={form.from_name}
            onChange={(e) => setForm((f) => ({ ...f, from_name: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email-sender-address">From address</Label>
          <Input
            id="email-sender-address"
            type="email"
            placeholder="e.g. hello@yourdomain.com"
            value={form.from_address}
            onChange={(e) => setForm((f) => ({ ...f, from_address: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">
            To send from your own domain we need to verify it — your admin will receive DNS records to add.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email-sender-replyto">Reply-To</Label>
          <Input
            id="email-sender-replyto"
            type="email"
            placeholder="e.g. hello@yourdomain.com"
            value={form.reply_to}
            onChange={(e) => setForm((f) => ({ ...f, reply_to: e.target.value }))}
          />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} size="sm">
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
