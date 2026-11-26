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
import { GlobeIcon } from "@/components/icons";
import { WebsiteChatAiReply, type AiReplyInitial } from "./website-chat-ai-reply";
import { toast } from "sonner";
import {
  BRAND_COLORS,
  contrastWithWhite,
  FORM_FIELD_KEYS,
  listedTimezone,
  MIN_COLOR_CONTRAST,
  normalizeHexColor,
  TIMEZONES,
  type FormFieldKey,
  type ReplyTime,
  type WebsiteChatSettings,
} from "@/lib/inbox/website-chat/settings";

interface WebsiteChatState {
  connected: boolean;
  enabled: boolean;
  settings: WebsiteChatSettings | null;
  snippet: string | null;
  /** Only the branded widget has one: the public id of its inbox. It is how the card tells the two kinds apart. */
  inboxIdentifier?: string;
  logoUrl: string | null;
  /** The "AI replies" part (Admizz only); absent when it is not available. */
  aiReply?: AiReplyInitial;
}

const API_PATH = "/api/v1/inbox/website-chat";

const REPLY_TIME_LABELS: Record<ReplyTime, string> = {
  in_a_few_minutes: "Typically replies in a few minutes",
  in_a_few_hours: "Typically replies in a few hours",
  in_a_day: "Typically replies in a day",
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  // What the admin typed in the custom colour box. Kept apart from draft.color, which only ever holds a
  // listed colour or a custom colour that passed the readability check.
  const [customText, setCustomText] = useState("");

  const apply = useCallback((next: WebsiteChatState) => {
    setState(next);
    setDraft(next.settings);
    setCustomText(next.settings?.color.startsWith("#") ? next.settings.color : "");
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

  /** Logo changes apply at once and never touch what the admin has typed but not saved yet. */
  async function changeLogo(request: Promise<Response>, success: string) {
    setBusy(true);
    try {
      const res = await request;
      if (!res.ok) {
        toast.error(await readError(res, "Something went wrong. Please try again."));
        return;
      }
      const next = (await res.json()).data as WebsiteChatState;
      setState((prev) => (prev ? { ...prev, logoUrl: next.logoUrl } : prev));
      toast.success(success);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function uploadLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error("That image is too big. Use one under 1 MB.");
      return;
    }
    const form = new FormData();
    form.append("logo", file);
    void changeLogo(fetch(`${API_PATH}/logo`, { method: "POST", body: form }), "Logo saved");
  }

  /** Turning office hours on pre-selects the admin's own time zone, so the hours are not silently set in UTC. */
  function setHours(patch: Partial<WebsiteChatSettings["officeHours"]>) {
    if (!draft) return;
    let next = { ...draft.officeHours, ...patch };
    if (patch.enabled === true && next.timezone === "UTC") {
      const mine = listedTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (mine) next = { ...next, timezone: mine };
    }
    setDraft({ ...draft, officeHours: next });
  }

  const customHex = normalizeHexColor(customText);
  const customContrast = customHex ? contrastWithWhite(customHex) : null;
  const customProblem =
    customText.trim() === ""
      ? null
      : !customHex
        ? "Enter a colour like #001353."
        : (customContrast ?? 0) < MIN_COLOR_CONTRAST
          ? `Too light for white text (${customContrast?.toFixed(1)}:1, needs ${MIN_COLOR_CONTRAST}:1). Pick a darker colour.`
          : null;

  /** Only a readable colour reaches the draft, so Save can never send one the server would refuse. */
  function chooseCustomColour(text: string) {
    setCustomText(text);
    const hex = normalizeHexColor(text);
    if (hex && contrastWithWhite(hex) >= MIN_COLOR_CONTRAST && draft) setDraft({ ...draft, color: hex });
  }

  const header = (
    <CardHeader>
      <div className="flex items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GlobeIcon className="h-4 w-4 text-muted-foreground" />
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
          <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
            <div className="flex flex-col justify-between gap-3 rounded-[12px] border p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Branded chat widget</p>
                <p className="text-xs text-muted-foreground">
                  Your own styled chat window, with your colours, logo and wording set in your website&apos;s code. Chats arrive in your Inbox.
                </p>
              </div>
              <Button size="sm" disabled={busy || !websiteHost.trim()} onClick={() => send("POST", { websiteHost, branded: true }, "Branded chat widget is connected")}>
                {busy ? "Setting things up…" : "Connect branded widget"}
              </Button>
            </div>
            <div className="flex flex-col justify-between gap-3 rounded-[12px] border p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Standard chat window</p>
                <p className="text-xs text-muted-foreground">
                  The ready-made chat window, styled here with a logo, colour and office hours. One line of code to paste on your site.
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={busy || !websiteHost.trim()} onClick={() => send("POST", { websiteHost }, "Website chat is connected")}>
                {busy ? "Setting things up…" : "Connect website chat"}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Either one creates your chat inbox and links it to EdgeX. Admins and owners only.</p>
        </CardContent>
      </Card>
    );
  }

  function setField(key: FormFieldKey, patch: Partial<{ show: boolean; required: boolean }>) {
    setDraft((d) => (d ? { ...d, fields: { ...d.fields, [key]: { ...d.fields[key], ...patch } } } : d));
  }

  // The branded widget is styled on the website, so the standard window's look, form and office hours do not apply to it.
  const branded = Boolean(state.inboxIdentifier);

  return (
    <Card>
      {header}
      <CardContent className="space-y-6">
        <div className="space-y-1.5 max-w-sm">
          <Label htmlFor="website-chat-host">Website address</Label>
          <Input id="website-chat-host" value={draft.websiteHost} onChange={(e) => setDraft({ ...draft, websiteHost: e.target.value })} />
          <p className="text-xs text-muted-foreground">Only this site can show the bubble.</p>
        </div>

        {branded && (
          <div className="max-w-2xl space-y-1.5 rounded-[12px] border p-3 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Branded chat widget.</span> Its colours, logo, wording and contact form are set in your
              website&apos;s code, not here. Visitors&apos; chats arrive in your Inbox.
            </p>
            <p>
              Inbox id (public, safe to put on your website): <code className="font-mono text-foreground">{state.inboxIdentifier}</code>
            </p>
          </div>
        )}

        {!branded && (
          <>
        <div className="space-y-3">
          <h3 className="text-sm font-medium">How the bubble looks</h3>
          <div className="space-y-1.5">
            <Label>Logo</Label>
            <div className="flex flex-wrap items-center gap-3">
              {state.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- the logo lives on the chat server, not a known image host
                <img src={state.logoUrl} alt="Chat logo" className="h-14 w-14 rounded-[14px] border object-cover" />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-[14px] border border-dashed text-xs text-muted-foreground">None</div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm" variant="outline" disabled={busy}>
                  <label className="cursor-pointer">
                    {state.logoUrl ? "Change logo" : "Upload logo"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      aria-label="Upload a logo"
                      className="sr-only"
                      onChange={(e) => {
                        uploadLogo(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </Button>
                {state.logoUrl && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void changeLogo(fetch(`${API_PATH}/logo`, { method: "DELETE" }), "Logo removed")}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">A square PNG, JPG or WebP under 1 MB. It shows at the top of the chat window.</p>
          </div>
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
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input
                type="color"
                aria-label="Pick a custom colour"
                value={customHex ?? "#001353"}
                onChange={(e) => chooseCustomColour(e.target.value)}
                className={`h-7 w-7 cursor-pointer rounded-full border-2 bg-transparent p-0 ${draft.color.startsWith("#") ? "border-foreground" : "border-transparent"}`}
              />
              <Input
                aria-label="Custom colour"
                placeholder="#001353"
                maxLength={7}
                value={customText}
                onChange={(e) => chooseCustomColour(e.target.value)}
                className="h-8 w-28"
              />
              <span className="text-xs text-muted-foreground">or enter your brand colour</span>
            </div>
            {customText.trim() !== "" && (
              <p className={`text-xs ${customProblem ? "text-destructive" : "text-muted-foreground"}`}>
                {customProblem ?? `Readable: white text on this colour is ${customContrast?.toFixed(1)}:1.`}
              </p>
            )}
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

        <div className="space-y-3">
          <h3 className="text-sm font-medium">Office hours</h3>
          <div className="flex items-center gap-2">
            <Switch
              id="website-chat-hours"
              checked={draft.officeHours.enabled}
              onCheckedChange={(enabled) => setHours({ enabled })}
            />
            <Label htmlFor="website-chat-hours" className="text-sm font-normal">
              Show &quot;away&quot; outside office hours
            </Label>
          </div>
          {draft.officeHours.enabled ? (
            <div className="space-y-3 max-w-2xl">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days the team is available">
                {DAY_LABELS.map((label, day) => {
                  const on = draft.officeHours.days.includes(day);
                  return (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setHours({ days: on ? draft.officeHours.days.filter((d) => d !== day) : [...draft.officeHours.days, day] })}
                      className={`rounded-[6px] border px-2.5 py-1 text-xs ${on ? "border-foreground bg-foreground text-background" : "text-muted-foreground"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="website-chat-open">Opens</Label>
                  <Input id="website-chat-open" type="time" value={draft.officeHours.open} onChange={(e) => setHours({ open: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="website-chat-close">Closes</Label>
                  <Input id="website-chat-close" type="time" value={draft.officeHours.close} onChange={(e) => setHours({ close: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Time zone</Label>
                  <Select value={draft.officeHours.timezone} onValueChange={(timezone) => setHours({ timezone })}>
                    <SelectTrigger aria-label="Time zone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Outside these hours visitors see that the team is away, and can still leave a message.</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Off: the chat always shows the team as online. Turn it on and set your real hours so visitors are not misled at night.</p>
          )}
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Visitors can send files:</span> off for now. EdgeX cannot show attachments yet, so they would be lost.
          </p>
          <p>
            <span className="font-medium text-foreground">Who replies:</span> visitors see the counselor&apos;s name. A counselor with no name on their profile shows as the team name.
          </p>
        </div>
          </>
        )}

        <Button size="sm" disabled={busy} onClick={() => send("PATCH", draft, "Website chat settings saved")}>
          {busy ? "Saving…" : "Save changes"}
        </Button>

        <WebsiteChatAiReply initial={state.aiReply} />

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
