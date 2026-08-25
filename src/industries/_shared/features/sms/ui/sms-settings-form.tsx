"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { smsGet, smsSend, SmsApiError } from "../lib/api-client";
import type { SmsSettings } from "../lib/types";

interface SmsSettingsFormProps {
  isAdmin: boolean;
}

export function SmsSettingsForm({ isAdmin }: SmsSettingsFormProps) {
  const [settings, setSettings] = useState<SmsSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    smsGet<SmsSettings>("/api/v1/sms/settings")
      .then(({ data }) => setSettings(data))
      .catch((e: SmsApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await smsSend<SmsSettings>("/api/v1/sms/settings", "PATCH", settings);
      setSettings(updated);
      toast.success("SMS settings saved.");
    } catch (e) {
      toast.error(e instanceof SmsApiError ? e.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading settings…</div>;
  if (error) return <div className="py-4 text-sm text-destructive">{error}</div>;
  if (!settings) return null;

  const disabled = !isAdmin || saving;

  return (
    <div className="flex flex-col gap-5 max-w-xl">
      {!isAdmin && <p className="text-xs text-muted-foreground">Only an owner or admin can change SMS settings.</p>}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sender-label">Sender label</Label>
        <Input
          id="sender-label"
          value={settings.sender_label ?? ""}
          onChange={(e) => setSettings({ ...settings, sender_label: e.target.value })}
          placeholder="e.g. Admizz"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">Prefixed to every message as &quot;Label: &quot;.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quiet-start">Quiet hours start (0-23)</Label>
          <Input
            id="quiet-start"
            type="number"
            min={0}
            max={23}
            value={settings.quiet_hours_start}
            onChange={(e) => setSettings({ ...settings, quiet_hours_start: Number(e.target.value) })}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quiet-end">Quiet hours end (0-23)</Label>
          <Input
            id="quiet-end"
            type="number"
            min={0}
            max={23}
            value={settings.quiet_hours_end}
            onChange={(e) => setSettings({ ...settings, quiet_hours_end: Number(e.target.value) })}
            disabled={disabled}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.quiet_hours_enabled}
          onChange={(e) => setSettings({ ...settings, quiet_hours_enabled: e.target.checked })}
          disabled={disabled}
        />
        Enforce quiet hours
      </label>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="timezone">Timezone</Label>
        <Input
          id="timezone"
          value={settings.timezone ?? ""}
          onChange={(e) => setSettings({ ...settings, timezone: e.target.value || null })}
          placeholder="Asia/Kathmandu (defaults to tenant timezone)"
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="optout-footer">Opt-out footer template</Label>
        <Textarea
          id="optout-footer"
          value={settings.optout_footer ?? ""}
          onChange={(e) => setSettings({ ...settings, optout_footer: e.target.value })}
          placeholder="Opt out: {url}"
          rows={2}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Include a literal &quot;{"{url}"}&quot; to insert the opt-out link — every character here is billed. Leave
          blank to send with no opt-out footer at all.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="max-recipients">Max recipients per blast</Label>
          <Input
            id="max-recipients"
            type="number"
            min={1}
            max={20000}
            value={settings.max_recipients_per_blast}
            onChange={(e) => setSettings({ ...settings, max_recipients_per_blast: Number(e.target.value) })}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="low-credit">Low-credit threshold</Label>
          <Input
            id="low-credit"
            type="number"
            min={0}
            value={settings.low_credit_threshold}
            onChange={(e) => setSettings({ ...settings, low_credit_threshold: Number(e.target.value) })}
            disabled={disabled}
          />
        </div>
      </div>

      {isAdmin && (
        <div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      )}
    </div>
  );
}
