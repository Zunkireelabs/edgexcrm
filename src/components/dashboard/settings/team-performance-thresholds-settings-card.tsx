"use client";

// Settings UI for the three Team & Lead Performance tunables that were
// hand-editable-JSON-only in Phase 1 (thresholds.ts's doc comment) — mirrors
// EmailBlastSettingsCard's fetch/save shape. Owner/admin only, education_consultancy
// only (gated by the caller — academic-operations-panel.tsx).

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clock } from "lucide-react";
import { toast } from "sonner";

interface Thresholds {
  followUpStaleDays: number;
  callbackReminderMinutes: number;
  intakeAlarmBucketsHours: [number, number];
}

export function TeamPerformanceThresholdsSettingsCard({ isAdmin }: { isAdmin: boolean }) {
  const [saved, setSaved] = useState<Thresholds | null>(null);
  const [staleDaysForm, setStaleDaysForm] = useState("");
  const [callbackMinutesForm, setCallbackMinutesForm] = useState("");
  const [bucket1Form, setBucket1Form] = useState("");
  const [bucket2Form, setBucket2Form] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/settings/team-performance-thresholds")
      .then((r) => r.json())
      .then((json) => {
        const d: Thresholds = json.data;
        setSaved(d);
        setStaleDaysForm(String(d.followUpStaleDays));
        setCallbackMinutesForm(String(d.callbackReminderMinutes));
        setBucket1Form(String(d.intakeAlarmBucketsHours[0]));
        setBucket2Form(String(d.intakeAlarmBucketsHours[1]));
      })
      .catch(() => toast.error("Failed to load team performance thresholds"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    const staleDays = Number(staleDaysForm);
    const callbackMinutes = Number(callbackMinutesForm);
    const bucket1 = Number(bucket1Form);
    const bucket2 = Number(bucket2Form);

    if (!Number.isInteger(staleDays) || staleDays < 1) {
      toast.error("Follow-up stale days must be an integer of at least 1");
      return;
    }
    if (!Number.isInteger(callbackMinutes) || callbackMinutes < 1) {
      toast.error("Callback reminder minutes must be an integer of at least 1");
      return;
    }
    if (!Number.isInteger(bucket1) || !Number.isInteger(bucket2) || bucket1 < 1 || bucket2 <= bucket1) {
      toast.error("Intake alarm buckets must be two ascending integers (hours)");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/v1/settings/team-performance-thresholds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          follow_up_stale_days: staleDays,
          callback_reminder_minutes: callbackMinutes,
          intake_alarm_buckets_hours: [bucket1, bucket2],
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const firstError =
          (Object.values(json.errors ?? {}).flat()[0] as string | undefined) ?? (json.error?.message as string | undefined);
        toast.error(firstError ?? "Failed to save thresholds");
        return;
      }
      setSaved(json.data);
      toast.success("Team performance thresholds saved");
    } catch {
      toast.error("Failed to save thresholds");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div className="border rounded-lg p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Team & Lead Performance Thresholds</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        <div className="space-y-1.5">
          <Label htmlFor={isAdmin ? "follow-up-stale-days" : undefined}>Follow-up stale (days)</Label>
          {isAdmin ? (
            <Input
              id="follow-up-stale-days"
              type="number"
              min={1}
              value={staleDaysForm}
              onChange={(e) => setStaleDaysForm(e.target.value)}
            />
          ) : (
            <p className="text-sm font-medium">{saved?.followUpStaleDays}</p>
          )}
          <p className="text-xs text-muted-foreground">
            A lead flags as follow-up-needed once this many days pass with no touch.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={isAdmin ? "callback-reminder-minutes" : undefined}>Callback reminder (minutes)</Label>
          {isAdmin ? (
            <Input
              id="callback-reminder-minutes"
              type="number"
              min={1}
              value={callbackMinutesForm}
              onChange={(e) => setCallbackMinutesForm(e.target.value)}
            />
          ) : (
            <p className="text-sm font-medium">{saved?.callbackReminderMinutes}</p>
          )}
          <p className="text-xs text-muted-foreground">
            A missed call (no answer/busy) flags callback-due after this many minutes.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={isAdmin ? "intake-bucket-1" : undefined}>Intake alarm bucket 1 (hours)</Label>
          {isAdmin ? (
            <Input
              id="intake-bucket-1"
              type="number"
              min={1}
              value={bucket1Form}
              onChange={(e) => setBucket1Form(e.target.value)}
            />
          ) : (
            <p className="text-sm font-medium">{saved?.intakeAlarmBucketsHours[0]}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={isAdmin ? "intake-bucket-2" : undefined}>Intake alarm bucket 2 (hours)</Label>
          {isAdmin ? (
            <Input
              id="intake-bucket-2"
              type="number"
              min={1}
              value={bucket2Form}
              onChange={(e) => setBucket2Form(e.target.value)}
            />
          ) : (
            <p className="text-sm font-medium">{saved?.intakeAlarmBucketsHours[1]}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Pre-qualified leads with no touch bucket into &quot;over bucket 1&quot; / &quot;over bucket 2&quot; age groups.
          </p>
        </div>
      </div>

      {isAdmin && (
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? "Saving…" : "Save"}
        </Button>
      )}
    </div>
  );
}
