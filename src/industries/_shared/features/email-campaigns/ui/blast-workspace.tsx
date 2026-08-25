"use client";

// /email-campaigns/[id] — loads the blast and renders the draft composer or
// the read-only detail view depending on status. Mirrors sms/ui/blast-workspace.tsx.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BlastComposer } from "./blast-composer";
import { BlastDetail } from "./blast-detail";
import { emailBlastGet, EmailBlastApiError } from "../lib/api-client";
import type { EmailBlastRow } from "../lib/types";

interface BlastWorkspaceProps {
  blastId: string;
  canSendEmail: boolean;
}

export function BlastWorkspace({ blastId, canSendEmail }: BlastWorkspaceProps) {
  const [blast, setBlast] = useState<EmailBlastRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    emailBlastGet<EmailBlastRow>(`/api/v1/email-blasts/${blastId}`)
      .then(({ data }) => setBlast(data))
      .catch((e: EmailBlastApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [blastId]);

  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/email-campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit">
        <ArrowLeft className="h-3.5 w-3.5" />
        All blasts
      </Link>

      {loading && <div className="py-12 text-center text-sm text-muted-foreground">Loading blast…</div>}
      {error && <div className="py-4 text-sm text-destructive">{error}</div>}

      {blast &&
        !loading &&
        (blast.status === "draft" ? (
          <BlastComposer blast={blast} onSent={load} canSendEmail={canSendEmail} />
        ) : (
          <BlastDetail blast={blast} canSendEmail={canSendEmail} onRefresh={load} />
        ))}
    </div>
  );
}
