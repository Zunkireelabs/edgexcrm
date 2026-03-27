"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Copy, ExternalLink, Check, X, Loader2 } from "lucide-react";

interface SettingsFormProps {
  tenant: Tenant;
  formConfigs: FormConfig[];
}

type SlugStatus = "idle" | "checking" | "available" | "taken" | "invalid";

function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function SettingsForm({ tenant, formConfigs }: SettingsFormProps) {
  const router = useRouter();
  const [name, setName] = useState(tenant.name);
  const [slug, setSlug] = useState(tenant.slug);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState(tenant.primary_color);
  const [saving, setSaving] = useState(false);

  const [selectedFormId, setSelectedFormId] = useState<string>(
    formConfigs[0]?.id || ""
  );
  const selectedForm = formConfigs.find((f) => f.id === selectedFormId) || null;

  const [redirectUrl, setRedirectUrl] = useState(
    selectedForm?.redirect_url || ""
  );

  const checkSlugAvailability = useCallback(
    async (slugToCheck: string) => {
      if (slugToCheck === tenant.slug) {
        setSlugStatus("idle");
        setSlugError(null);
        return;
      }

      if (slugToCheck.length < 2) {
        setSlugStatus("invalid");
        setSlugError("Slug must be at least 2 characters");
        return;
      }

      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugToCheck)) {
        setSlugStatus("invalid");
        setSlugError("Only lowercase letters, numbers, and hyphens allowed");
        return;
      }

      setSlugStatus("checking");
      setSlugError(null);

      try {
        const res = await fetch(
          `/api/v1/settings/check-slug?slug=${encodeURIComponent(slugToCheck)}`
        );
        const json = await res.json();

        if (!res.ok) {
          const errorMsg =
            json.error?.details?.slug?.[0] || json.error?.message || "Error checking slug";
          setSlugStatus("invalid");
          setSlugError(errorMsg);
          return;
        }

        if (json.data.available) {
          setSlugStatus("available");
          setSlugError(null);
        } else {
          setSlugStatus("taken");
          setSlugError("This slug is already taken");
        }
      } catch {
        setSlugStatus("invalid");
        setSlugError("Failed to check availability");
      }
    },
    [tenant.slug]
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedCheck = useCallback(
    debounce((s: string) => checkSlugAvailability(s), 400),
    [checkSlugAvailability]
  );

  useEffect(() => {
    if (slug !== tenant.slug) {
      debouncedCheck(slug);
    }
  }, [slug, tenant.slug, debouncedCheck]);

  function handleSlugChange(value: string) {
    const normalized = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setSlug(normalized);
  }

  function handleFormSelect(formId: string) {
    setSelectedFormId(formId);
    const form = formConfigs.find((f) => f.id === formId);
    setRedirectUrl(form?.redirect_url || "");
  }

  const slugChanged = slug !== tenant.slug;
  const canSave = !slugChanged || slugStatus === "available" || slugStatus === "idle";

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const formUrl = selectedForm
    ? `${origin}/form/${tenant.slug}/${selectedForm.slug}`
    : `${origin}/form/${tenant.slug}`;
  const embedCode = `<iframe src="${formUrl}" width="100%" height="800" frameborder="0" style="border:none;max-width:600px;margin:0 auto;display:block;"></iframe>`;

  async function handleSave() {
    if (!canSave) {
      toast.error("Please fix the slug before saving");
      return;
    }

    setSaving(true);
    const supabase = createClient();

    const updateData: { name: string; primary_color: string; slug?: string } = {
      name,
      primary_color: primaryColor,
    };

    if (slugChanged && slugStatus === "available") {
      updateData.slug = slug;
    }

    const { error: tenantError } = await supabase
      .from("tenants")
      .update(updateData)
      .eq("id", tenant.id);

    if (tenantError) {
      if (tenantError.code === "23505") {
        toast.error("This slug is already taken");
        setSlugStatus("taken");
        setSlugError("This slug is already taken");
      } else {
        toast.error("Failed to save tenant settings");
      }
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
            <Label htmlFor="slug">Slug</Label>
            <div className="relative">
              <Input
                id="slug"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                className={
                  slugStatus === "taken" || slugStatus === "invalid"
                    ? "border-red-500 pr-10"
                    : slugStatus === "available"
                    ? "border-green-500 pr-10"
                    : "pr-10"
                }
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {slugStatus === "checking" && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {slugStatus === "available" && (
                  <Check className="h-4 w-4 text-green-500" />
                )}
                {(slugStatus === "taken" || slugStatus === "invalid") && (
                  <X className="h-4 w-4 text-red-500" />
                )}
              </div>
            </div>
            {slugError && (
              <p className="text-sm text-red-500">{slugError}</p>
            )}
            {slugStatus === "available" && (
              <p className="text-sm text-green-600">Slug is available</p>
            )}
            <p className="text-xs text-muted-foreground">
              Your form URL: {origin}/form/{slug}
            </p>
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
          <Button onClick={handleSave} disabled={saving || !canSave}>
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
