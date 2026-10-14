"use client";

import { useRef } from "react";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { countSegments } from "@/lib/sms/segments";
import {
  estimateRenderedBody,
  SMS_AUTORESPONDER_BODY_MAX,
  SMS_AUTORESPONDER_DEFAULTS,
} from "@/lib/sms/form-autoresponder-config";
import type { FormStep } from "@/types/database";
import type { AutoresponderConfig, BuilderAction, SmsAutoresponderConfig } from "../types";

// Merge tags that resolve for every lead. Custom form fields are added from the form's own steps
// (their answers are merge-taggable at send time too).
const STANDARD_TOKENS = ["first_name", "last_name", "email", "phone", "city", "country"];

interface SmsAutoresponderEditorProps {
  autoresponder: AutoresponderConfig;
  steps: FormStep[];
  dispatch: React.Dispatch<BuilderAction>;
}

export function SmsAutoresponderEditor({ autoresponder, steps, dispatch }: SmsAutoresponderEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sms: SmsAutoresponderConfig = { ...SMS_AUTORESPONDER_DEFAULTS, ...(autoresponder.sms ?? {}) };

  function update(patch: Partial<SmsAutoresponderConfig>) {
    dispatch({ type: "SET_AUTORESPONDER", payload: { sms: { ...sms, ...patch } } });
  }

  const formFieldTokens = Array.from(new Set(steps.flatMap((s) => s.fields.map((f) => f.name)))).filter(
    (name) => !STANDARD_TOKENS.includes(name)
  );
  const allTokens = [...STANDARD_TOKENS, ...formFieldTokens];

  function insertToken(token: string) {
    const el = textareaRef.current;
    if (!el) {
      toast.info("Click into the message first");
      return;
    }
    const tag = `{{${token}}}`;
    const start = el.selectionStart ?? sms.body.length;
    const end = el.selectionEnd ?? sms.body.length;
    const next = (sms.body.slice(0, start) + tag + sms.body.slice(end)).slice(0, SMS_AUTORESPONDER_BODY_MAX);
    update({ body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  // Counts the admin's text only; the sender name and opt-out link are added on top when it is sent,
  // so the real cost can be a little higher than shown here.
  const info = sms.body ? countSegments(estimateRenderedBody(sms.body)) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Confirmation SMS</CardTitle>
          <CardDescription>
            Text the person right after they submit this form. Keep it short and transactional — a
            receipt and what happens next.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={sms.enabled}
              onClick={() => update({ enabled: !sms.enabled })}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                sms.enabled ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${
                  sms.enabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
            <Label className="cursor-pointer" onClick={() => update({ enabled: !sms.enabled })}>
              {sms.enabled ? "Enabled" : "Disabled"}
            </Label>
          </div>
        </CardContent>
      </Card>

      {sms.enabled && (
        <>
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
                    name="sms_fire_mode"
                    value={value}
                    checked={sms.fire_mode === value}
                    onChange={() => update({ fire_mode: value })}
                    className="accent-primary"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Message</CardTitle>
              <CardDescription>
                Plain text. Use <code className="text-xs bg-muted px-1 rounded">{"{{token}}"}</code> merge
                tags to include what they submitted. Your sender name and an opt-out link are added
                automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sms-ar-body">Text</Label>
                <textarea
                  id="sms-ar-body"
                  ref={textareaRef}
                  value={sms.body}
                  maxLength={SMS_AUTORESPONDER_BODY_MAX}
                  rows={5}
                  onChange={(e) => update({ body: e.target.value })}
                  placeholder="Hi {{first_name}}, thanks for registering. We'll contact you shortly."
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {info
                    ? `${info.chars} characters · ${info.segments} ${info.segments === 1 ? "segment" : "segments"} · ${info.credits} ${info.credits === 1 ? "credit" : "credits"} per text (estimate — each merge tag counted as ~10 characters, before the sender name and opt-out link)`
                    : "Write the message to see its length and credit cost."}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Available merge tags — click to insert at cursor
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {allTokens.map((token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => insertToken(token)}
                      title={`Insert {{${token}}}`}
                      className="px-2 py-0.5 rounded bg-muted text-xs font-mono hover:bg-primary/10 hover:text-primary transition-colors"
                    >
                      {`{{${token}}}`}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Texts are only sent to Nepal mobile numbers, and each one uses SMS credits. If the account is
            out of credits the submission still goes through — the text just isn&apos;t sent.
          </div>
        </>
      )}
    </div>
  );
}
