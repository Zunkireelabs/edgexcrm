"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FileText, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

interface ConsentTemplate {
  id: string;
  title: string;
  body: string;
  version: number;
  require_drawn_signature: boolean;
  link_expiry_days: number;
  is_active: boolean;
}

function buildDefault(): Omit<ConsentTemplate, "id" | "version"> {
  return {
    title: "Student Consent & Authorization",
    body: "",
    require_drawn_signature: false,
    link_expiry_days: 14,
    is_active: false,
  };
}

export function ConsentManager() {
  const [template, setTemplate] = useState<ConsentTemplate | null>(null);
  const [form, setForm] = useState(buildDefault());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchTemplate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/consent-template");
      if (res.ok) {
        const json = await res.json();
        const data = json.data as ConsentTemplate | null;
        setTemplate(data);
        if (data) {
          setForm({
            title: data.title,
            body: data.body,
            require_drawn_signature: data.require_drawn_signature,
            link_expiry_days: data.link_expiry_days,
            is_active: data.is_active,
          });
        }
      }
    } catch {
      toast.error("Failed to load consent template");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTemplate(); }, [fetchTemplate]);

  async function handleSave() {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    if (!form.body.trim()) { toast.error("Consent document body is required"); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/v1/consent-template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to save");
      }
      const json = await res.json();
      const saved = json.data as ConsentTemplate;
      setTemplate(saved);
      toast.success(`Consent template saved (v${saved.version})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    const newActive = !form.is_active;
    if (newActive && (!form.body.trim() || !form.title.trim())) {
      toast.error("Add a title and body before activating the consent gate");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/consent-template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, is_active: newActive }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setForm((f) => ({ ...f, is_active: newActive }));
      toast.success(newActive ? "Consent gate activated" : "Consent gate deactivated");
    } catch {
      toast.error("Failed to update consent gate");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card id="consent">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Student Consent
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="consent">
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Student Consent
          </CardTitle>
          <CardDescription>
            Require students to sign a consent document before any application can be created.
            {template && <span className="ml-1 text-xs text-muted-foreground/70">(v{template.version})</span>}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">
            {form.is_active ? "Gate ON" : "Gate OFF"}
          </span>
          <button
            type="button"
            onClick={handleToggleActive}
            disabled={saving}
            title={form.is_active ? "Deactivate consent gate" : "Activate consent gate"}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {form.is_active
              ? <ToggleRight className="h-6 w-6 text-green-600" />
              : <ToggleLeft className="h-6 w-6" />
            }
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Student Consent & Authorization"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Consent Document Body</Label>
          <textarea
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder="Enter the full text of the consent document that students will read and sign…"
            rows={8}
            className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          <p className="text-xs text-muted-foreground">
            Merge fields auto-fill per student when the link is sent:{" "}
            <code className="text-foreground">{"{{student_name}}"}</code>,{" "}
            <code className="text-foreground">{"{{student_email}}"}</code>,{" "}
            <code className="text-foreground">{"{{student_phone}}"}</code>,{" "}
            <code className="text-foreground">{"{{city}}"}</code>,{" "}
            <code className="text-foreground">{"{{country}}"}</code>,{" "}
            <code className="text-foreground">{"{{organization}}"}</code>,{" "}
            <code className="text-foreground">{"{{date}}"}</code>,{" "}
            <code className="text-foreground">{"{{consent_version}}"}</code>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Link Expiry (days)</Label>
            <Input
              type="number"
              min={1}
              max={90}
              value={form.link_expiry_days}
              onChange={(e) => setForm((f) => ({ ...f, link_expiry_days: Math.max(1, Number(e.target.value)) }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="block mb-2">Require Drawn Signature</Label>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, require_drawn_signature: !f.require_drawn_signature }))}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title={form.require_drawn_signature ? "Disable drawn signature" : "Enable drawn signature"}
            >
              {form.require_drawn_signature
                ? <ToggleRight className="h-6 w-6 text-green-600" />
                : <ToggleLeft className="h-6 w-6" />
              }
            </button>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Template"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
