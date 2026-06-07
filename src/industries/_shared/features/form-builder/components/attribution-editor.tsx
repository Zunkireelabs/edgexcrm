"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FormAttribution } from "@/types/database";
import type { BuilderAction } from "../types";

interface AttributionEditorProps {
  attribution: FormAttribution;
  dispatch: React.Dispatch<BuilderAction>;
}

export function AttributionEditor({ attribution, dispatch }: AttributionEditorProps) {
  function update(patch: Partial<FormAttribution>) {
    dispatch({ type: "SET_ATTRIBUTION", payload: patch });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Default Attribution</CardTitle>
          <CardDescription>
            Applied to every lead from this form when the URL has no <code className="text-xs bg-muted px-1 rounded">?utm_*</code> params.
            URL values always win when present.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="attr-source">Default Source</Label>
            <Input
              id="attr-source"
              value={attribution.default_source ?? ""}
              onChange={(e) => update({ default_source: e.target.value || null })}
              placeholder="e.g. website, organic, partner"
            />
            <p className="text-xs text-muted-foreground">
              Where the lead originated (e.g. facebook, google, website).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="attr-medium">Default Medium</Label>
            <Input
              id="attr-medium"
              value={attribution.default_medium ?? ""}
              onChange={(e) => update({ default_medium: e.target.value || null })}
              placeholder="e.g. organic, email, social"
            />
            <p className="text-xs text-muted-foreground">
              The marketing channel (e.g. paid_ad, email, organic).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="attr-campaign">Default Campaign</Label>
            <Input
              id="attr-campaign"
              value={attribution.default_campaign ?? ""}
              onChange={(e) => update({ default_campaign: e.target.value || null })}
              placeholder="e.g. summer_intake_2026"
            />
            <p className="text-xs text-muted-foreground">
              The specific campaign name (e.g. summer2026, scholarship_drive).
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
