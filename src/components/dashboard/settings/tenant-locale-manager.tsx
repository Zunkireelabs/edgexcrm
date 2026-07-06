"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Globe } from "lucide-react";
import { toast } from "sonner";

const TIMEZONE_OPTIONS = [
  { value: "Asia/Kathmandu", label: "Kathmandu (Nepal Time)" },
  { value: "Asia/Kolkata", label: "Kolkata (India)" },
  { value: "Asia/Dhaka", label: "Dhaka (Bangladesh)" },
  { value: "Asia/Dubai", label: "Dubai (UAE)" },
  { value: "Asia/Karachi", label: "Karachi (Pakistan)" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Europe/London", label: "London" },
  { value: "America/New_York", label: "New York" },
  { value: "UTC", label: "UTC" },
];

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

interface TenantLocaleManagerProps {
  timezone: string;
  weekendDays: number[];
}

export function TenantLocaleManager({ timezone, weekendDays }: TenantLocaleManagerProps) {
  const [tz, setTz] = useState(timezone);
  const [weekend, setWeekend] = useState<number[]>(weekendDays);
  const [saving, setSaving] = useState(false);

  const dirty = tz !== timezone || JSON.stringify([...weekend].sort()) !== JSON.stringify([...weekendDays].sort());

  function toggleWeekendDay(day: number, checked: boolean) {
    setWeekend((prev) => (checked ? [...prev, day] : prev.filter((d) => d !== day)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/tenant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: tz, weekend_days: weekend }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to save locale settings");
      toast.success("Locale settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save locale settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Locale
        </CardTitle>
        <CardDescription>
          Timezone and weekend days used for leave day-counting and scheduling.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Timezone</label>
          <Select value={tz} onValueChange={setTz}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Weekend days</label>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((day) => (
              <label key={day.value} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={weekend.includes(day.value)}
                  onCheckedChange={(v) => toggleWeekendDay(day.value, !!v)}
                />
                {day.label}
              </label>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t">
          <Button onClick={handleSave} disabled={saving || !dirty} size="sm">
            {saving ? "Saving…" : "Save locale settings"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
