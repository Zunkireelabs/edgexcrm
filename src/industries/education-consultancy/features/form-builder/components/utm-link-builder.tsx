"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CopyButton } from "@/components/ui/copy-button";

interface UtmLinkBuilderProps {
  tenantSlug: string;
  forms: { id: string; name: string; slug: string }[];
}

function getBaseUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_URL || "";
}

export function UtmLinkBuilder({ tenantSlug, forms }: UtmLinkBuilderProps) {
  const [formSlug, setFormSlug] = useState<string>(forms[0]?.slug ?? "");
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");

  const trackingUrl = useMemo(() => {
    if (!formSlug) return "";
    const base = `${getBaseUrl()}/form/${tenantSlug}/${formSlug}`;
    const params = new URLSearchParams();
    if (source.trim()) params.set("utm_source", source.trim());
    if (medium.trim()) params.set("utm_medium", medium.trim());
    if (campaign.trim()) params.set("utm_campaign", campaign.trim());
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }, [formSlug, source, medium, campaign, tenantSlug]);

  if (forms.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          You haven&apos;t created any forms yet. Create a form first, then come back to generate tracking links.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Build your tracking link</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Form picker */}
        <div className="space-y-2">
          <Label htmlFor="utm-form">Form *</Label>
          <Select value={formSlug} onValueChange={setFormSlug}>
            <SelectTrigger id="utm-form">
              <SelectValue placeholder="Pick a form" />
            </SelectTrigger>
            <SelectContent>
              {forms.map((f) => (
                <SelectItem key={f.id} value={f.slug}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              {trackingUrl || "Pick a form to generate a link"}
            </code>
            {trackingUrl && <CopyButton value={trackingUrl} label="Tracking link" />}
          </div>
          {trackingUrl && (
            <a
              href={trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mt-1"
            >
              <ExternalLink className="h-3 w-3" />
              Open in new tab
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
