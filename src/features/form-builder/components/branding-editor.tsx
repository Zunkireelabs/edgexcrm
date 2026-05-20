"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FormBranding } from "@/types/database";
import type { BuilderAction } from "../types";

interface BrandingEditorProps {
  branding: FormBranding;
  redirectUrl: string | null;
  dispatch: React.Dispatch<BuilderAction>;
}

export function BrandingEditor({ branding, redirectUrl, dispatch }: BrandingEditorProps) {
  function updateBranding(patch: Partial<FormBranding>) {
    dispatch({ type: "SET_BRANDING", payload: patch });
  }

  return (
    <div className="space-y-4">
      {/* Form header */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Form Header</CardTitle>
          <CardDescription className="text-xs">Shown at the top of the public form</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="b-title">Title *</Label>
            <Input
              id="b-title"
              value={branding.title ?? ""}
              onChange={(e) => updateBranding({ title: e.target.value })}
              placeholder="e.g. Scholarship Application"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-subtitle">Subtitle</Label>
            <Input
              id="b-subtitle"
              value={branding.subtitle ?? ""}
              onChange={(e) => updateBranding({ subtitle: e.target.value })}
              placeholder="Optional subtitle or description"
            />
          </div>
        </CardContent>
      </Card>

      {/* Colors */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Colors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="space-y-1.5 flex-1">
              <Label htmlFor="b-primary-color">Primary Color</Label>
              <Input
                id="b-primary-color"
                value={branding.primary_color ?? "#6366f1"}
                onChange={(e) => updateBranding({ primary_color: e.target.value })}
                placeholder="#6366f1"
              />
            </div>
            <div className="pt-6">
              <input
                type="color"
                value={branding.primary_color ?? "#6366f1"}
                onChange={(e) => updateBranding({ primary_color: e.target.value })}
                className="h-9 w-9 rounded border cursor-pointer"
                aria-label="Pick primary color"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="space-y-1.5 flex-1">
              <Label htmlFor="b-button-color">Button Color</Label>
              <Input
                id="b-button-color"
                value={branding.button_color ?? ""}
                onChange={(e) => updateBranding({ button_color: e.target.value })}
                placeholder="Same as primary color"
              />
            </div>
            <div className="pt-6">
              <input
                type="color"
                value={branding.button_color || branding.primary_color || "#6366f1"}
                onChange={(e) => updateBranding({ button_color: e.target.value })}
                className="h-9 w-9 rounded border cursor-pointer"
                aria-label="Pick button color"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Submit button */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Submit Button</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="b-button-text">Button Text</Label>
            <Input
              id="b-button-text"
              value={branding.button_text ?? "Submit"}
              onChange={(e) => updateBranding({ button_text: e.target.value })}
              placeholder="Submit Application"
            />
          </div>
        </CardContent>
      </Card>

      {/* Thank you screen */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Thank You Screen</CardTitle>
          <CardDescription className="text-xs">Shown after form submission</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="b-ty-title">Thank You Title</Label>
            <Input
              id="b-ty-title"
              value={branding.thank_you_title ?? ""}
              onChange={(e) => updateBranding({ thank_you_title: e.target.value })}
              placeholder="Thank you!"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-ty-message">Thank You Message</Label>
            <Textarea
              id="b-ty-message"
              value={branding.thank_you_message ?? ""}
              onChange={(e) => updateBranding({ thank_you_message: e.target.value })}
              placeholder="Your submission has been received."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Post-submission redirect */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Post-Submission Redirect</CardTitle>
          <CardDescription className="text-xs">Redirect users to a URL after submitting</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label htmlFor="redirect-url">Redirect URL</Label>
            <Input
              id="redirect-url"
              value={redirectUrl ?? ""}
              onChange={(e) =>
                dispatch({ type: "SET_REDIRECT_URL", payload: e.target.value || null })
              }
              placeholder="https://yourwebsite.com/thank-you"
            />
          </div>
        </CardContent>
      </Card>

      {/* Form display options */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Display Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="b-hide-labels"
              checked={branding.hide_labels ?? false}
              onCheckedChange={(checked) => updateBranding({ hide_labels: checked === true })}
            />
            <Label htmlFor="b-hide-labels" className="cursor-pointer">Hide field labels (use placeholders only)</Label>
          </div>
        </CardContent>
      </Card>

      {/* Logo & misc */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Logo & Links</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="b-logo-url">Logo URL</Label>
            <Input
              id="b-logo-url"
              value={branding.logo_url ?? ""}
              onChange={(e) => updateBranding({ logo_url: e.target.value })}
              placeholder="https://yourwebsite.com/logo.png"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="b-privacy-url">Privacy Policy URL</Label>
            <Input
              id="b-privacy-url"
              value={branding.privacy_url ?? ""}
              onChange={(e) => updateBranding({ privacy_url: e.target.value })}
              placeholder="https://yourwebsite.com/privacy"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
