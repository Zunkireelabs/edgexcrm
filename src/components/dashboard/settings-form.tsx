"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Tenant, FormConfig } from "@/types/database";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";

interface SettingsFormProps {
  tenant: Tenant;
  formConfigs: FormConfig[];
}

export function SettingsForm({ tenant, formConfigs }: SettingsFormProps) {
  const router = useRouter();
  const [name, setName] = useState(tenant.name);
  const [primaryColor, setPrimaryColor] = useState(tenant.primary_color);
  const [saving, setSaving] = useState(false);

  const [selectedFormId, setSelectedFormId] = useState<string>(
    formConfigs[0]?.id || ""
  );
  const selectedForm = formConfigs.find((f) => f.id === selectedFormId) || null;

  const [redirectUrl, setRedirectUrl] = useState(
    selectedForm?.redirect_url || ""
  );

  function handleFormSelect(formId: string) {
    setSelectedFormId(formId);
    const form = formConfigs.find((f) => f.id === formId);
    setRedirectUrl(form?.redirect_url || "");
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const formUrl = selectedForm
    ? `${origin}/form/${tenant.slug}/${selectedForm.slug}`
    : `${origin}/form/${tenant.slug}`;
  const embedCode = `<iframe src="${formUrl}" width="100%" height="800" frameborder="0" style="border:none;max-width:600px;margin:0 auto;display:block;"></iframe>`;

  async function handleSave() {
    setSaving(true);
    const supabase = createClient();

    const { error: tenantError } = await supabase
      .from("tenants")
      .update({ name, primary_color: primaryColor })
      .eq("id", tenant.id);

    if (tenantError) {
      toast.error("Failed to save tenant settings");
      setSaving(false);
      return;
    }

    if (selectedForm) {
      await supabase
        .from("form_configs")
        .update({ redirect_url: redirectUrl || null })
        .eq("id", selectedForm.id);
    }

    setSaving(false);
    toast.success("Settings saved");
    router.refresh();
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  }

  const hasMultipleForms = formConfigs.length > 1;

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>
            Basic settings for your organization
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Organization Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="slug">Slug (read-only)</Label>
            <Input id="slug" value={tenant.slug} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="color">Brand Color</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-10 w-10 rounded border cursor-pointer"
              />
              <Input
                id="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-32"
              />
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Form Embed</CardTitle>
          <CardDescription>
            Share or embed your lead capture form{hasMultipleForms ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasMultipleForms && (
            <div className="space-y-2">
              <Label>Select Form</Label>
              <Select value={selectedFormId} onValueChange={handleFormSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a form" />
                </SelectTrigger>
                <SelectContent>
                  {formConfigs.map((form) => (
                    <SelectItem key={form.id} value={form.id}>
                      {form.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Direct Link</Label>
            <div className="flex gap-2">
              <Input value={formUrl} readOnly />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(formUrl, "Form URL")}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <a href={formUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="icon">
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </a>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Embed Code (iframe)</Label>
            <div className="flex gap-2">
              <Input value={embedCode} readOnly className="text-xs" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(embedCode, "Embed code")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="redirect">Post-Submission Redirect URL</Label>
            <div className="flex gap-2">
              <Input
                id="redirect"
                type="url"
                placeholder="https://yoursite.com"
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedForm ? `Applies to: ${selectedForm.name}` : "Select a form first"}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
