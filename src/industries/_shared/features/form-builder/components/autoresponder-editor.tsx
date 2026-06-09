"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import type { FormStep } from "@/types/database";
import type { AutoresponderConfig, BuilderAction } from "../types";

const STANDARD_TOKENS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "city",
  "country",
  "tenant_name",
];

interface AutoresponderEditorProps {
  autoresponder: AutoresponderConfig;
  steps: FormStep[];
  dispatch: React.Dispatch<BuilderAction>;
}

export function AutoresponderEditor({
  autoresponder,
  steps,
  dispatch,
}: AutoresponderEditorProps) {
  function update(patch: Partial<AutoresponderConfig>) {
    dispatch({ type: "SET_AUTORESPONDER", payload: patch });
  }

  // Collect unique field names from all steps for merge-tag chips
  const formFieldTokens = Array.from(
    new Set(steps.flatMap((s) => s.fields.map((f) => f.name)))
  ).filter((name) => !STANDARD_TOKENS.includes(name));

  const allTokens = [...STANDARD_TOKENS, ...formFieldTokens];

  function copyToken(token: string) {
    navigator.clipboard.writeText(`{{${token}}}`).catch(() => {});
  }

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Confirmation Email</CardTitle>
          <CardDescription>
            Send an automated receipt to the submitter when this form is submitted. Keep content
            transactional — confirmation details, next steps, contact info.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={autoresponder.enabled}
              onClick={() => update({ enabled: !autoresponder.enabled })}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                autoresponder.enabled ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                  autoresponder.enabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
            <Label className="cursor-pointer" onClick={() => update({ enabled: !autoresponder.enabled })}>
              {autoresponder.enabled ? "Enabled" : "Disabled"}
            </Label>
          </div>
        </CardContent>
      </Card>

      {autoresponder.enabled && (
        <>
          {/* Fire mode */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Send Frequency</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(
                [
                  { value: "every", label: "Send on every submission" },
                  { value: "first", label: "Send only the first time" },
                ] as const
              ).map(({ value, label }) => (
                <label key={value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="fire_mode"
                    value={value}
                    checked={autoresponder.fire_mode === value}
                    onChange={() => update({ fire_mode: value })}
                    className="accent-primary"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </CardContent>
          </Card>

          {/* Subject + body */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Email Content</CardTitle>
              <CardDescription>
                Use <code className="text-xs bg-muted px-1 rounded">{"{{token}}"}</code> merge tags
                to echo submitted field values into the email. Click a tag below to copy it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ar-subject">Subject</Label>
                <Input
                  id="ar-subject"
                  value={autoresponder.subject}
                  onChange={(e) => update({ subject: e.target.value })}
                  placeholder="Thanks for your submission, {{first_name}}!"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ar-body">Body</Label>
                <textarea
                  id="ar-body"
                  value={autoresponder.body_html}
                  onChange={(e) => update({ body_html: e.target.value })}
                  placeholder={"Hi {{first_name}},\n\nWe received your enquiry and will be in touch shortly."}
                  rows={8}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Line breaks are preserved automatically. Field values are inserted safely (HTML-escaped).
                </p>
              </div>

              {/* Merge-tag chips */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Available merge tags — click to copy</p>
                <div className="flex flex-wrap gap-1.5">
                  {allTokens.map((token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => copyToken(token)}
                      title={`Copy {{${token}}}`}
                      className="px-2 py-0.5 rounded bg-muted text-xs font-mono hover:bg-primary/10 hover:text-primary transition-colors"
                    >
                      {`{{${token}}}`}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Warning */}
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
            <p>
              A stage-based welcome rule on the entry stage will also fire on submission — both
              emails may send.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
