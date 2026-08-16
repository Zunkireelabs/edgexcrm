"use client";

// /sms/[id] — loads the blast and renders the draft composer or the
// read-only detail view depending on status. The single component the
// sms/[id]/page.tsx thin shell delegates to.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BlastComposer } from "./blast-composer";
import { BlastDetail } from "./blast-detail";
import { smsGet, SmsApiError } from "../lib/api-client";
import type { SmsBlastRow } from "../lib/types";

interface BlastWorkspaceProps {
  blastId: string;
  canSendSms: boolean;
  sandboxed: boolean;
}

export function BlastWorkspace({ blastId, canSendSms, sandboxed }: BlastWorkspaceProps) {
  const [blast, setBlast] = useState<SmsBlastRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    smsGet<SmsBlastRow>(`/api/v1/sms/blasts/${blastId}`)
      .then(({ data }) => setBlast(data))
      .catch((e: SmsApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [blastId]);

  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/sms" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit">
        <ArrowLeft className="h-3.5 w-3.5" />
        All blasts
      </Link>

      {loading && <div className="py-12 text-center text-sm text-muted-foreground">Loading blast…</div>}
      {error && <div className="py-4 text-sm text-destructive">{error}</div>}

      {blast && !loading && (
        blast.status === "draft" ? (
          <BlastComposer blast={blast} onSent={load} canSendSms={canSendSms} sandboxed={sandboxed} />
        ) : (
          <BlastDetail blast={blast} canSendSms={canSendSms} onRefresh={load} />
        )
      )}
    </div>
  );
}
