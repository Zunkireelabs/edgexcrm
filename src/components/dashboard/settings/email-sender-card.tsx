"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EnvelopeSimpleIcon } from "@/components/icons";
import { toast } from "sonner";

interface EmailSenderSettings {
  from_name: string | null;
  from_address: string | null;
  reply_to: string | null;
  domain_verified: boolean;
  no_reply_address: string | null;
  template_color: string | null;
  template_accent: string | null;
  updated_at: string | null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A small swatch next to a colour box: the colour when it is valid, an empty outline otherwise. */
function Swatch({ value }: { value: string }) {
  const ok = HEX.test(value.trim());
  return (
    <span
      aria-hidden
      className="inline-block h-9 w-9 shrink-0 rounded-md border"
      style={ok ? { backgroundColor: value.trim() } : undefined}
    />
  );
}

export function EmailSenderCard() {
  const [settings, setSettings] = useState<EmailSenderSettings>({
    from_name: null,
    from_address: null,
    reply_to: null,
    domain_verified: false,
    no_reply_address: null,
    template_color: null,
    template_accent: null,
    updated_at: null,
  });
  const [form, setForm] = useState({
    from_name: "",
    from_address: "",
    reply_to: "",
    no_reply_address: "",
    template_color: "",
    template_accent: "",
  });
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
          no_reply_address: d.no_reply_address ?? "",
          template_color: d.template_color ?? "",
          template_accent: d.template_accent ?? "",
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
          no_reply_address: form.no_reply_address || null,
          template_color: form.template_color || null,
          template_accent: form.template_accent || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const firstError = Object.values(json.error?.details ?? json.errors ?? {}).flat()[0] as string | undefined;
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
        <EnvelopeSimpleIcon className="h-4 w-4 text-muted-foreground" />
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

        <div className="space-y-1.5 border-t pt-4">
          <Label htmlFor="email-sender-noreply">No-reply address (optional)</Label>
          <Input
            id="email-sender-noreply"
            type="email"
            placeholder="e.g. no-reply@yourdomain.com"
            value={form.no_reply_address}
            onChange={(e) => setForm((f) => ({ ...f, no_reply_address: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">
            A second sender for information emails. It must be on the same domain as the From address. Emails sent from it
            use the company layout (logo, colour bar and footer), and the pop-up has a Preview button.
          </p>
          {form.no_reply_address.trim() && !settings.domain_verified && (
            <p role="status" className="text-xs font-medium text-amber-600">
              Not active yet: it appears in the New email pop-up once the company address is verified.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="email-template-color">Layout colour</Label>
            <div className="flex items-center gap-2">
              <Input
                id="email-template-color"
                placeholder="#0D1282"
                value={form.template_color}
                onChange={(e) => setForm((f) => ({ ...f, template_color: e.target.value }))}
              />
              <Swatch value={form.template_color} />
            </div>
            <p className="text-xs text-muted-foreground">Colour bar and footer. Empty uses the company brand colour.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-template-accent">Accent colour</Label>
            <div className="flex items-center gap-2">
              <Input
                id="email-template-accent"
                placeholder="#FDED22"
                value={form.template_accent}
                onChange={(e) => setForm((f) => ({ ...f, template_accent: e.target.value }))}
              />
              <Swatch value={form.template_accent} />
            </div>
            <p className="text-xs text-muted-foreground">A short tab in the colour bar and the footer link. Optional.</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">The logo in the layout is the company logo.</p>
      </div>

      <Button onClick={handleSave} disabled={saving} size="sm">
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
