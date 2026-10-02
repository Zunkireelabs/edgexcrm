"use client";

// F4 (docs/BLAST-F3-F4-FIX-BRIEF.md item 3) — the admin-facing surface for
// tenant_email_settings.max_recipients_per_blast (migration 228). Deliberately
// a separate card from EmailSenderCard (sender identity is general-email, this
// field is email-CAMPAIGNS-specific) and only rendered when the tenant has the
// email-campaigns feature — see communications-panel.tsx's hasEmailCampaigns
// gate. Mirrors EmailSenderCard's fetch/save shape exactly.

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Send } from "lucide-react";
import { toast } from "sonner";

interface EmailBlastSettings {
  max_recipients_per_blast: number;
  daily_send_cap?: number;
  daily_send_cap_min?: number;
  daily_send_cap_max?: number;
}

const FALLBACK_DAILY_MIN = 50;
const FALLBACK_DAILY_MAX = 5000;

interface EmailBlastSettingsCardProps {
  // Passed down from useSettingsModal()'s isSettingsAdmin rather than read via
  // the hook directly — this card lives outside the settings-modal folder and
  // shouldn't couple to the modal's context provider (PR #514 review, Finding
  // 3). PATCH is admin-only server-side; a non-admin gets a read-only value
  // instead of an Input + Save button they can't use.
  isAdmin: boolean;
}

export function EmailBlastSettingsCard({ isAdmin }: EmailBlastSettingsCardProps) {
  const [cap, setCap] = useState<number | null>(null);
  const [form, setForm] = useState("");
  // Daily send limit — the most emails EdgeX sends per day for this account (campaigns AND sequences share it).
  const [dailyCap, setDailyCap] = useState<number | null>(null);
  const [dailyForm, setDailyForm] = useState("");
  const [dailyMin, setDailyMin] = useState(FALLBACK_DAILY_MIN);
  const [dailyMax, setDailyMax] = useState(FALLBACK_DAILY_MAX);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/email-blasts/settings")
      .then((r) => r.json())
      .then((json) => {
        const d: EmailBlastSettings = json.data;
        setCap(d.max_recipients_per_blast);
        setForm(String(d.max_recipients_per_blast));
        if (d.daily_send_cap !== undefined) {
          setDailyCap(d.daily_send_cap);
          setDailyForm(String(d.daily_send_cap));
        }
        if (d.daily_send_cap_min !== undefined) setDailyMin(d.daily_send_cap_min);
        if (d.daily_send_cap_max !== undefined) setDailyMax(d.daily_send_cap_max);
      })
      .catch(() => toast.error("Failed to load email blast settings"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    // Send only what changed — saving one limit never rewrites the other.
    const body: Record<string, number> = {};

    const n = Number(form);
    if (cap === null || n !== cap) {
      if (!Number.isInteger(n) || n < 1 || n > 20000) {
        toast.error("Recipient cap must be an integer between 1 and 20,000");
        return;
      }
      body.max_recipients_per_blast = n;
    }

    if (dailyCap !== null) {
      const d = Number(dailyForm);
      if (d !== dailyCap) {
        if (!Number.isInteger(d) || d < dailyMin || d > dailyMax) {
          toast.error(`Daily send limit must be an integer between ${dailyMin.toLocaleString()} and ${dailyMax.toLocaleString()}`);
          return;
        }
        body.daily_send_cap = d;
      }
    }

    if (Object.keys(body).length === 0) {
      toast.message("Nothing to save");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/v1/email-blasts/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        // apiValidationError() returns { errors: {...} }; apiForbidden() returns
        // { error: { message } } — a real 403 (e.g. non-admin somehow reaching
        // this path) fell through both lookups to the generic fallback before
        // this second read was added (PR #514 review, Finding 3).
        const firstError =
          (Object.values(json.errors ?? {}).flat()[0] as string | undefined) ?? (json.error?.message as string | undefined);
        toast.error(firstError ?? "Failed to save settings");
        return;
      }
      setCap(json.data.max_recipients_per_blast);
      if (json.data.daily_send_cap !== undefined) {
        setDailyCap(json.data.daily_send_cap);
        setDailyForm(String(json.data.daily_send_cap));
      }
      toast.success("Email limits saved");
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
        <Send className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Email Limits</h2>
      </div>

      <div className="space-y-1.5 max-w-xs">
        <Label htmlFor={isAdmin ? "email-blast-recipient-cap" : undefined}>
          Recipient cap per blast
        </Label>
        {isAdmin ? (
          <Input
            id="email-blast-recipient-cap"
            type="number"
            min={1}
            max={20000}
            value={form}
            onChange={(e) => setForm(e.target.value)}
          />
        ) : (
          <p className="text-sm font-medium">{cap}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {isAdmin
            ? `A blast to more leads than this is rejected, not truncated. Current: ${cap}.`
            : "A blast to more leads than this is rejected, not truncated. Ask an owner or admin to change it."}
        </p>
      </div>

      {dailyCap !== null && (
        <div className="space-y-1.5 max-w-xs">
          <Label htmlFor={isAdmin ? "email-daily-send-limit" : undefined}>Daily send limit</Label>
          {isAdmin ? (
            <Input
              id="email-daily-send-limit"
              type="number"
              min={dailyMin}
              max={dailyMax}
              value={dailyForm}
              onChange={(e) => setDailyForm(e.target.value)}
            />
          ) : (
            <p className="text-sm font-medium">{dailyCap.toLocaleString()}</p>
          )}
          <p className="text-xs text-muted-foreground">
            The most emails EdgeX sends per day for this account — campaigns and sequences share it. Anything above it
            waits for the next day; nothing is dropped.
            {isAdmin
              ? ` Allowed: ${dailyMin.toLocaleString()}–${dailyMax.toLocaleString()}. Current: ${dailyCap.toLocaleString()}.`
              : " Ask an owner or admin to change it."}
          </p>
          {isAdmin && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Raise it gradually. Sending many more emails than usual in a day can push them into spam and hurt delivery
              for everyone sending from this domain.
            </p>
          )}
        </div>
      )}

      {isAdmin && (
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? "Saving…" : "Save"}
        </Button>
      )}
    </div>
  );
}
