"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/ui/copy-button";

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
    // Allow relative-ish input by prefixing https:// when scheme missing
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // Strip any existing UTM params so we don't duplicate
  url.searchParams.delete("utm_source");
  url.searchParams.delete("utm_medium");
  url.searchParams.delete("utm_campaign");
  if (source.trim()) url.searchParams.set("utm_source", source.trim());
  if (medium.trim()) url.searchParams.set("utm_medium", medium.trim());
  if (campaign.trim()) url.searchParams.set("utm_campaign", campaign.trim());
  return url.toString();
}

export function UtmLinkBuilder() {
  const [destinationUrl, setDestinationUrl] = useState("");
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");

  const trackingUrl = useMemo(
    () => buildTrackingUrl(destinationUrl, source, medium, campaign),
    [destinationUrl, source, medium, campaign],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Build your tracking link</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Destination URL */}
        <div className="space-y-2">
          <Label htmlFor="utm-destination">Destination URL *</Label>
          <Input
            id="utm-destination"
            value={destinationUrl}
            onChange={(e) => setDestinationUrl(e.target.value)}
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
                  Paste a destination URL to generate a tracking link
                </span>
              )}
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
