"use client";

// /email-campaigns — recent blasts + New blast button. Mirrors sms/ui/sms-dashboard.tsx
// minus the credits/settings/suppressions tabs (no credit ledger for email;
// suppressions and settings already exist elsewhere — email_suppressions has
// no dedicated UI yet, out of this phase's scope). Owns the only "New blast"
// entry point: POST /email-blasts creates the draft, then routes to
// /email-campaigns/[id] where blast-composer takes over.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, Plus } from "lucide-react";
import { emailBlastGet, emailBlastSend, EmailBlastApiError } from "../lib/api-client";
import type { EmailBlastRow, EmailBlastStatus } from "../lib/types";

interface EmailCampaignsDashboardProps {
  canSendEmail: boolean;
}

const STATUS_BADGE: Record<EmailBlastStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  scheduled: "secondary",
  queued: "secondary",
  sending: "default",
  throttled: "secondary",
  sent: "default",
  partially_failed: "destructive",
  failed: "destructive",
  cancelled: "outline",
};

export function EmailCampaignsDashboard({ canSendEmail }: EmailCampaignsDashboardProps) {
  const router = useRouter();
  const [blasts, setBlasts] = useState<EmailBlastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);

  useEffect(() => {
    emailBlastGet<EmailBlastRow[]>("/api/v1/email-blasts?page=1&pageSize=20")
      .then(({ data }) => setBlasts(data))
      .catch((e: EmailBlastApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleNewBlast() {
    setCreatingDraft(true);
    try {
      const draft = await emailBlastSend<EmailBlastRow>("/api/v1/email-blasts", "POST", {
        name: "Untitled blast",
        subject_template: " ",
        body_template: " ",
      });
      router.push(`/email-campaigns/${draft.id}`);
    } catch (e) {
      toast.error(e instanceof EmailBlastApiError ? e.message : "Failed to create draft blast.");
    } finally {
      setCreatingDraft(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Email Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">One-shot email blasts to your leads.</p>
        </div>
        {canSendEmail && (
          <Button onClick={handleNewBlast} disabled={creatingDraft}>
            <Plus className="h-4 w-4" />
            New blast
          </Button>
        )}
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading blasts…</div>
      ) : blasts.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
          <Mail className="h-8 w-8 opacity-40" />
          <p className="text-sm">No blasts yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {blasts.map((b) => (
            <Link
              key={b.id}
              href={`/email-campaigns/${b.id}`}
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
    </div>
  );
}
