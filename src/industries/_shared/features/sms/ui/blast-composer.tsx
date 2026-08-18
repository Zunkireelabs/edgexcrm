"use client";

// Draft-blast composer (SMS-PHASE3B-BRIEF.md §3). Reuses the existing
// advanced-filter builder for the audience — no second filter UI — and never
// re-implements segment/credit math; character-counter.tsx imports the same
// countSegments the server bills from.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AdvancedFilterBar } from "@/components/filters/advanced-filter-bar";
import { leadFields } from "@/lib/filters/registry/leads";
import { EMPTY_TREE, type CompileCtx, type FilterTree } from "@/lib/filters/types";
import { CharacterCounter } from "./character-counter";
import { CostPreviewDialog } from "./cost-preview-dialog";
import { SendConfirmDialog } from "./send-confirm-dialog";
import { smsSend, SmsApiError } from "../lib/api-client";
import type { SmsBlastRow, SmsPreviewResponse } from "../lib/types";

interface BlastComposerProps {
  blast: SmsBlastRow;
  onSent: () => void;
  canSendSms: boolean;
  sandboxed: boolean;
}

const AUTOSAVE_DEBOUNCE_MS = 800;
const PREVIEW_DEBOUNCE_MS = 600;

export function BlastComposer({ blast, onSent, canSendSms, sandboxed }: BlastComposerProps) {
  const router = useRouter();

  const [name, setName] = useState(blast.name);
  const [body, setBody] = useState(blast.body);
  const [tree, setTree] = useState<FilterTree>(blast.audience_filter ?? EMPTY_TREE);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const [liveMeta, setLiveMeta] = useState<{ prefix: string; footer: string; sendable: number; matched: number } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmedPreview, setConfirmedPreview] = useState<SmsPreviewResponse | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const registry = useMemo(
    () => leadFields({ tz: "UTC", now: new Date(0), industryId: "education_consultancy", permissions: {} } satisfies CompileCtx),
    []
  );
  const fields = useMemo(() => Object.values(registry), [registry]);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autosave — never lose a typed body to a refresh (SMS-PHASE3B-BRIEF.md §4).
  // The parent (blast-workspace.tsx) only mounts this component while
  // blast.status === "draft" and unmounts/swaps it the instant a send call
  // flips that status, so this effect can assume draft for its whole lifetime.
  useEffect(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      setSaving(true);
      smsSend<SmsBlastRow>(`/api/v1/sms/blasts/${blast.id}`, "PATCH", { name, body, audience_filter: tree })
        .then(() => setSavedAt(new Date()))
        .catch((e: SmsApiError) => toast.error(`Autosave failed: ${e.message}`))
        .finally(() => setSaving(false));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, body, tree]);

  // Live preview refresh — keeps the counter's prefix/footer and the audience
  // summary line current without a network call per keystroke; character-counter
  // still recomputes segments instantly on every render from local state.
  useEffect(() => {
    if (!body.trim()) {
      setLiveMeta(null);
      return;
    }
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      smsSend<SmsPreviewResponse>(`/api/v1/sms/blasts/${blast.id}/preview`, "POST", { body, audience_filter: tree })
        .then((p) =>
          setLiveMeta({ prefix: p.message.prefix, footer: p.message.footer, sendable: p.audience.sendable, matched: p.audience.matched })
        )
        .catch(() => void 0);
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [body, tree, blast.id]);

  async function handleConfirmSend() {
    setSending(true);
    setSendError(null);
    try {
      await smsSend(`/api/v1/sms/blasts/${blast.id}/send`, "POST");
      toast.success("Blast queued for send.");
      setConfirmOpen(false);
      onSent();
      router.refresh();
    } catch (e) {
      setSendError(e instanceof SmsApiError ? e.message : "Failed to send blast.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="blast-name">Blast name</Label>
        <Input id="blast-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. August intake reminder" disabled={!canSendSms} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="blast-body">Message</Label>
          <CharacterCounter body={body} prefix={liveMeta?.prefix ?? ""} footer={liveMeta?.footer ?? ""} />
        </div>
        <Textarea
          id="blast-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Hi {{first_name}}, …"
          rows={5}
          disabled={!canSendSms}
        />
        <p className="text-xs text-muted-foreground">
          {saving ? "Saving…" : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : "Draft"}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Audience</Label>
        <AdvancedFilterBar entity="leads" fields={fields} value={tree} onChange={setTree} allowGroups={false} />
        {liveMeta && (
          <p className="text-xs text-muted-foreground">
            {liveMeta.sendable} sendable of {liveMeta.matched} matched leads.
          </p>
        )}
      </div>

      {canSendSms && (
        <div className="flex items-center gap-2">
          <Button onClick={() => setPreviewOpen(true)} disabled={!body.trim()}>
            Review &amp; send
          </Button>
        </div>
      )}

      <CostPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        blastId={blast.id}
        body={body}
        onContinue={(preview) => {
          setConfirmedPreview(preview);
          setPreviewOpen(false);
          setSendError(null);
          setConfirmOpen(true);
        }}
      />

      <SendConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        recipientCount={confirmedPreview?.audience.sendable ?? 0}
        sandboxed={sandboxed}
        sending={sending}
        error={sendError}
        onConfirm={handleConfirmSend}
      />
    </div>
  );
}
