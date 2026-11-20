"use client";

// Settings > Communications > "Website chat" (admin only). Connect once, then manage the bubble:
// on/off, colour, wording, the short form, and the one-line code for the website. All server rules
// live in /api/v1/inbox/website-chat; this card only shows state and sends changes.

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CopyButton } from "@/components/ui/copy-button";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import {
  BRAND_COLORS,
  FORM_FIELD_KEYS,
  type FormFieldKey,
  type ReplyTime,
  type WebsiteChatSettings,
} from "@/lib/inbox/website-chat/settings";

interface WebsiteChatState {
  connected: boolean;
  enabled: boolean;
  settings: WebsiteChatSettings | null;
  snippet: string | null;
}

const API_PATH = "/api/v1/inbox/website-chat";

const REPLY_TIME_LABELS: Record<ReplyTime, string> = {
  in_a_few_minutes: "Typically replies in a few minutes",
  in_a_few_hours: "Typically replies in a few hours",
  in_a_day: "Typically replies in a day",
};

const FIELD_LABELS: Record<FormFieldKey, string> = {
  name: "Name",
  phone: "WhatsApp number",
  email: "Email",
};

async function readError(res: Response, fallback: string): Promise<string> {
  const json = await res.json().catch(() => null);
  // The API answers { error: { message, details: { field: ["what is wrong"] } } }. Show the field message when
  // there is one, so "Validation failed" never hides the reason.
  const firstDetail = Object.values(json?.error?.details ?? {}).flat()[0] as string | undefined;
  return firstDetail ?? (json?.error?.message as string | undefined) ?? fallback;
}

export function WebsiteChatCard() {
  const [state, setState] = useState<WebsiteChatState | null>(null);
  // null = still loading, false = not available on this server (card stays hidden)
  const [available, setAvailable] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<WebsiteChatSettings | null>(null);
  const [websiteHost, setWebsiteHost] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = useCallback((next: WebsiteChatState) => {
    setState(next);
    setDraft(next.settings);
  }, []);

  useEffect(() => {
    fetch(API_PATH)
      .then(async (res) => {
        if (!res.ok) {
          setAvailable(false);
          return;
        }
        apply((await res.json()).data);
        setAvailable(true);
      })
      .catch(() => setAvailable(false));
  }, [apply]);

  async function send(method: "POST" | "PATCH", body: unknown, success: string) {
    setBusy(true);
    try {
      const res = await fetch(API_PATH, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        toast.error(await readError(res, "Something went wrong. Please try again."));
        return;
      }
      apply((await res.json()).data);
      toast.success(success);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!available || !state) return null;

  const header = (
    <CardHeader>
      <div className="flex items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4 text-muted-foreground" />
          Website chat
          <Badge variant={state.connected && state.enabled ? "default" : "secondary"}>
            {!state.connected ? "Not connected" : state.enabled ? "Chat on" : "Chat off"}
          </Badge>
        </CardTitle>
        {state.connected && (
          <div className="flex items-center gap-2">
            <Label htmlFor="website-chat-enabled" className="text-sm font-normal">
              Chat on
            </Label>
            <Switch
              id="website-chat-enabled"
              checked={state.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => send("PATCH", { enabled }, enabled ? "Website chat is on" : "Website chat is off")}
            />
          </div>
        )}
      </div>
      <CardDescription>
        Add a chat bubble to your website. Visitors fill a short form, then write. Their chats arrive in your Inbox, and you reply from there.
      </CardDescription>
    </CardHeader>
  );

  if (!state.connected || !draft) {
    return (
      <Card>
        {header}
        <CardContent className="space-y-4">
          <div className="space-y-1.5 max-w-sm">
            <Label htmlFor="website-chat-host">Your website address</Label>
            <Input
              id="website-chat-host"
              placeholder="example.com"
              value={websiteHost}
              onChange={(e) => setWebsiteHost(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Only this site can show the bubble.</p>
          </div>
          <Button size="sm" disabled={busy || !websiteHost.trim()} onClick={() => send("POST", { websiteHost }, "Website chat is connected")}>
            {busy ? "Setting things up…" : "Connect website chat"}
          </Button>
          <p className="text-xs text-muted-foreground">
            This creates your chat inbox, links it to EdgeX and gives you one line of code to paste on your site. Admins and owners only.
          </p>
        </CardContent>
      </Card>
    );
  }

  function setField(key: FormFieldKey, patch: Partial<{ show: boolean; required: boolean }>) {
    setDraft((d) => (d ? { ...d, fields: { ...d.fields, [key]: { ...d.fields[key], ...patch } } } : d));
  }

  return (
    <Card>
      {header}
      <CardContent className="space-y-6">
        <div className="space-y-1.5 max-w-sm">
          <Label htmlFor="website-chat-host">Website address</Label>
          <Input id="website-chat-host" value={draft.websiteHost} onChange={(e) => setDraft({ ...draft, websiteHost: e.target.value })} />
          <p className="text-xs text-muted-foreground">Only this site can show the bubble.</p>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium">How the bubble looks</h3>
          <div className="space-y-1.5">
            <Label>Colour</Label>
            <div className="flex flex-wrap gap-2">
              {BRAND_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-label={c.label}
                  aria-pressed={draft.color === c.id}
                  title={c.label}
                  onClick={() => setDraft({ ...draft, color: c.id })}
                  className={`h-7 w-7 rounded-full border-2 ${draft.color === c.id ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 max-w-2xl">
            <div className="space-y-1.5">
              <Label htmlFor="website-chat-title">Title</Label>
              <Input id="website-chat-title" value={draft.title} maxLength={60} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="website-chat-tagline">Tagline</Label>
              <Input id="website-chat-tagline" value={draft.tagline} maxLength={120} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5 max-w-sm">
            <Label>Reply time shown</Label>
            <Select value={draft.replyTime} onValueChange={(v) => setDraft({ ...draft, replyTime: v as ReplyTime })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(REPLY_TIME_LABELS) as ReplyTime[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {REPLY_TIME_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium">The short form before chatting</h3>
          <div className="space-y-1.5 max-w-2xl">
            <Label htmlFor="website-chat-intro">Intro line</Label>
            <Input id="website-chat-intro" value={draft.formIntro} maxLength={200} onChange={(e) => setDraft({ ...draft, formIntro: e.target.value })} />
          </div>
          <table className="text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pr-8 pb-1 font-medium">Field</th>
                <th className="pr-6 pb-1 font-medium">Show</th>
                <th className="pb-1 font-medium">Required</th>
              </tr>
            </thead>
            <tbody>
              {FORM_FIELD_KEYS.map((key) => (
                <tr key={key}>
                  <td className="pr-8 py-1">{FIELD_LABELS[key]}</td>
                  <td className="pr-6 py-1">
                    <Checkbox
                      aria-label={`Show ${FIELD_LABELS[key]}`}
                      checked={draft.fields[key].show}
                      onCheckedChange={(v) => setField(key, { show: v === true, ...(v === true ? {} : { required: false }) })}
                    />
                  </td>
                  <td className="py-1">
                    <Checkbox
                      aria-label={`${FIELD_LABELS[key]} required`}
                      checked={draft.fields[key].required}
                      disabled={!draft.fields[key].show}
                      onCheckedChange={(v) => setField(key, { required: v === true })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            The message box always shows. It is built into the chat engine and cannot be removed. The number box has a country picker.
          </p>
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Visitors can send files:</span> off for now. EdgeX cannot show attachments yet, so they would be lost.
          </p>
          <p>
            <span className="font-medium text-foreground">Who replies:</span> visitors see the counselor&apos;s name. A counselor with no name on their profile shows as the team name.
          </p>
        </div>

        <Button size="sm" disabled={busy} onClick={() => send("PATCH", draft, "Website chat settings saved")}>
          {busy ? "Saving…" : "Save changes"}
        </Button>

        {state.snippet && (
          <div className="space-y-1.5 border-t pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Put it on your website</h3>
              <CopyButton value={state.snippet} />
            </div>
            <p className="text-xs text-muted-foreground">Paste this once, before the closing body tag of your website.</p>
            <pre className="rounded bg-muted p-3 text-xs overflow-x-auto">{state.snippet}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
