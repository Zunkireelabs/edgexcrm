"use client";

import { useMemo, useState } from "react";
import { ChevronsUpDown, Check, ExternalLink, Loader2, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CopyButton } from "@/components/ui/copy-button";
import type { UtmLink } from "@/types/database";
import { FORM_PUBLIC_BASE_URL } from "../lib/constants";

interface FormOption {
  id: string;
  name: string;
  slug: string;
}

interface UtmLinkBuilderProps {
  tenantSlug: string;
  forms: FormOption[];
  onSaved?: (link: UtmLink) => void;
}

function buildTrackingUrl(
  destinationUrl: string,
  source: string,
  medium: string,
  campaign: string,
): string | null {
  const trimmed = destinationUrl.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    url = new URL(withScheme);
  } catch {
    return null;
  }
  url.searchParams.delete("utm_source");
  url.searchParams.delete("utm_medium");
  url.searchParams.delete("utm_campaign");
  if (source.trim()) url.searchParams.set("utm_source", source.trim());
  if (medium.trim()) url.searchParams.set("utm_medium", medium.trim());
  if (campaign.trim()) url.searchParams.set("utm_campaign", campaign.trim());
  return url.toString();
}

export function UtmLinkBuilder({ tenantSlug, forms, onSaved }: UtmLinkBuilderProps) {
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [destinationUrl, setDestinationUrl] = useState("");
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");
  const [saving, setSaving] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedForm = forms.find((f) => f.id === selectedFormId) ?? null;
  const filteredForms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return forms;
    return forms.filter(
      (f) => f.name.toLowerCase().includes(q) || f.slug.toLowerCase().includes(q),
    );
  }, [forms, search]);

  function handleSelectForm(form: FormOption) {
    setSelectedFormId(form.id);
    setDestinationUrl(`${FORM_PUBLIC_BASE_URL}/form/${tenantSlug}/${form.slug}`);
    setPickerOpen(false);
    setSearch("");
  }

  const trackingUrl = useMemo(
    () => buildTrackingUrl(destinationUrl, source, medium, campaign),
    [destinationUrl, source, medium, campaign],
  );

  async function handleSave() {
    if (!trackingUrl || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/utm-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form_id: selectedFormId,
          destination_url: destinationUrl,
          utm_source: source,
          utm_medium: medium,
          utm_campaign: campaign,
          tracking_url: trackingUrl,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to save link");
      }
      toast.success("Link saved");
      onSaved?.(json.data as UtmLink);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save link");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Build your tracking link</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Form picker */}
        <div className="space-y-2">
          <Label>Pick one of your forms</Label>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={pickerOpen}
                className="w-full justify-between font-normal"
              >
                <span className={selectedForm ? "" : "text-muted-foreground"}>
                  {selectedForm ? selectedForm.name : "Select a form..."}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[var(--radix-popover-trigger-width)] p-0"
            >
              <div className="flex items-center border-b px-3">
                <Search className="h-4 w-4 shrink-0 opacity-50 mr-2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search forms..."
                  className="flex h-9 w-full rounded-md bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  autoFocus
                />
              </div>
              <div className="max-h-[260px] overflow-y-auto py-1">
                {filteredForms.length === 0 ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    No forms match &ldquo;{search}&rdquo;
                  </div>
                ) : (
                  filteredForms.map((form) => {
                    const isSelected = form.id === selectedFormId;
                    return (
                      <button
                        key={form.id}
                        type="button"
                        onClick={() => handleSelectForm(form)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent hover:text-accent-foreground transition-colors"
                      >
                        <Check
                          className={`h-4 w-4 shrink-0 ${isSelected ? "opacity-100" : "opacity-0"}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{form.name}</div>
                          <div className="text-xs text-muted-foreground truncate">/{form.slug}</div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>
          <p className="text-xs text-muted-foreground">
            Picks the URL automatically. You can still edit it below or paste a different one.
          </p>
        </div>

        {/* Destination URL */}
        <div className="space-y-2">
          <Label htmlFor="utm-destination">Destination URL *</Label>
          <Input
            id="utm-destination"
            value={destinationUrl}
            onChange={(e) => {
              setDestinationUrl(e.target.value);
              setSelectedFormId(null);
            }}
            placeholder="https://your-website.com/contact"
          />
          <p className="text-xs text-muted-foreground">
            The page you&apos;ll send Facebook/Google/etc. visitors to. Can be your own website, our form widget, or any URL.
          </p>
        </div>

        {/* UTM inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="utm-source">Source</Label>
            <Input
              id="utm-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. facebook"
            />
            <p className="text-xs text-muted-foreground">Where the link will be shared</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="utm-medium">Medium</Label>
            <Input
              id="utm-medium"
              value={medium}
              onChange={(e) => setMedium(e.target.value)}
              placeholder="e.g. paid_ad"
            />
            <p className="text-xs text-muted-foreground">The channel type</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="utm-campaign">Campaign</Label>
          <Input
            id="utm-campaign"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            placeholder="e.g. summer2026"
          />
          <p className="text-xs text-muted-foreground">A name for this specific campaign</p>
        </div>

        {/* Output */}
        <div className="space-y-2 pt-2 border-t">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Your tracking link
          </Label>
          <div className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2.5">
            <code className="flex-1 text-xs break-all leading-relaxed">
              {trackingUrl || (
                <span className="text-muted-foreground italic">
                  Pick a form or paste a destination URL to generate a tracking link
                </span>
              )}
            </code>
            {trackingUrl && <CopyButton value={trackingUrl} label="Tracking link" />}
          </div>
          <div className="flex items-center gap-3 pt-1">
            {trackingUrl && (
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Open in new tab
              </a>
            )}
            <div className="ml-auto">
              <Button
                type="button"
                size="sm"
                variant="default"
                disabled={!trackingUrl || saving}
                onClick={handleSave}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                )}
                Save link
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
