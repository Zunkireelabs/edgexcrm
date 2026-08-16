"use client";

// /sms — credit balance card + recent blasts + New blast button, plus tabs
// for Credits / Suppressions / Settings (SMS-PHASE3B-BRIEF.md §3). Owns the
// only "New blast" entry point: POST /blasts creates the draft, then routes
// to /sms/[id] where blast-composer takes over.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MessageSquare, Plus, AlertTriangle } from "lucide-react";
import { smsGet, smsSend, SmsApiError } from "../lib/api-client";
import { CreditLedgerTable } from "./credit-ledger-table";
import { SuppressionList } from "./suppression-list";
import { SmsSettingsForm } from "./sms-settings-form";
import type { SmsBlastRow, SmsBlastStatus, SmsCreditAccount, SmsSettings } from "../lib/types";

interface SmsDashboardProps {
  canSendSms: boolean;
  isAdmin: boolean;
}

const STATUS_BADGE: Record<SmsBlastStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  scheduled: "secondary",
  queued: "secondary",
  sending: "default",
  sent: "default",
  partially_failed: "destructive",
  failed: "destructive",
  cancelled: "outline",
};

export function SmsDashboard({ canSendSms, isAdmin }: SmsDashboardProps) {
  const router = useRouter();
  const [account, setAccount] = useState<SmsCreditAccount | null>(null);
  const [settings, setSettings] = useState<SmsSettings | null>(null);
  const [blasts, setBlasts] = useState<SmsBlastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);

  useEffect(() => {
    Promise.all([
      smsGet<{ account: SmsCreditAccount }>("/api/v1/sms/credits"),
      smsGet<SmsSettings>("/api/v1/sms/settings"),
      smsGet<SmsBlastRow[]>("/api/v1/sms/blasts?page=1&pageSize=20"),
    ])
      .then(([credits, settingsRes, blastsRes]) => {
        setAccount(credits.data.account);
        setSettings(settingsRes.data);
        setBlasts(blastsRes.data);
      })
      .catch((e: SmsApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleNewBlast() {
    setCreatingDraft(true);
    try {
      // body:"" fails the create route's required("body") validator (§4 of
      // SMS-PHASE3A-BRIEF.md) — a lone space satisfies it without leaving
      // visible placeholder text in the composer textarea; blast-composer's
      // autosave overwrites it with the real body within AUTOSAVE_DEBOUNCE_MS
      // of the first keystroke.
      const draft = await smsSend<SmsBlastRow>("/api/v1/sms/blasts", "POST", { name: "Untitled blast", body: " " });
      router.push(`/sms/${draft.id}`);
    } catch (e) {
      toast.error(e instanceof SmsApiError ? e.message : "Failed to create draft blast.");
    } finally {
      setCreatingDraft(false);
    }
  }

  const lowBalance = account && settings && account.balance <= settings.low_credit_threshold;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">SMS</h1>
          <p className="text-sm text-muted-foreground mt-1">Blast messages to your leads.</p>
        </div>
        {canSendSms && (
          <Button onClick={handleNewBlast} disabled={creatingDraft}>
            <Plus className="h-4 w-4" />
            New blast
          </Button>
        )}
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      <Card>
        <CardContent className="p-5">
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading balance…</div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className="text-2xl font-semibold tabular-nums">{account?.balance ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Reserved</p>
                  <p className="text-2xl font-semibold tabular-nums">{account?.reserved ?? 0}</p>
                </div>
              </div>
              {lowBalance && (
                <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Balance is at or below the low-credit threshold ({settings?.low_credit_threshold}).
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="blasts">
        <TabsList>
          <TabsTrigger value="blasts">Blasts</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="suppressions">Suppressions</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="blasts" className="pt-4">
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading blasts…</div>
          ) : blasts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <MessageSquare className="h-8 w-8 opacity-40" />
              <p className="text-sm">No blasts yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {blasts.map((b) => (
                <Link
                  key={b.id}
                  href={`/sms/${b.id}`}
                  className="flex items-center justify-between rounded-md border p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.recipients_total > 0 ? `${b.recipients_total} recipients` : "No recipients yet"} · Updated{" "}
                      {new Date(b.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant={STATUS_BADGE[b.status]} className="shrink-0 ml-3">
                    {b.status.replace(/_/g, " ")}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="credits" className="pt-4">
          <CreditLedgerTable />
        </TabsContent>

        <TabsContent value="suppressions" className="pt-4">
          <SuppressionList canManage={canSendSms} />
        </TabsContent>

        <TabsContent value="settings" className="pt-4">
          <SmsSettingsForm isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
