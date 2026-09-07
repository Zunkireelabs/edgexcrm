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
}

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/email-blasts/settings")
      .then((r) => r.json())
      .then((json) => {
        const d: EmailBlastSettings = json.data;
        setCap(d.max_recipients_per_blast);
        setForm(String(d.max_recipients_per_blast));
      })
      .catch(() => toast.error("Failed to load email blast settings"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    const n = Number(form);
    if (!Number.isInteger(n) || n < 1 || n > 20000) {
      toast.error("Must be an integer between 1 and 20,000");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/email-blasts/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max_recipients_per_blast: n }),
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
      toast.success("Email blast settings saved");
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
        <h2 className="font-semibold">Email Blast Limits</h2>
      </div>

      <div className="space-y-1.5 max-w-xs">
        <Label htmlFor="email-blast-recipient-cap">Recipient cap per blast</Label>
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
          <p id="email-blast-recipient-cap" className="text-sm font-medium">
            {cap}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {isAdmin
            ? `A blast to more leads than this is rejected, not truncated. Current: ${cap}.`
            : "A blast to more leads than this is rejected, not truncated. Ask an owner or admin to change it."}
        </p>
      </div>

      {isAdmin && (
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? "Saving…" : "Save"}
        </Button>
      )}
    </div>
  );
}
