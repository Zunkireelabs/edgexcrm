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
import type { FilterOption } from "@/components/filters/types";
import { leadFields } from "@/lib/filters/registry/leads";
import { EMPTY_TREE, type CompileCtx, type FilterTree } from "@/lib/filters/types";
import { PROSPECT_INDUSTRIES } from "@/industries/it-agency/leads/prospect-industries";
import { CharacterCounter } from "./character-counter";
import { CostPreviewDialog } from "./cost-preview-dialog";
import { SendConfirmDialog } from "./send-confirm-dialog";
import { smsSend, smsGet, SmsApiError } from "../lib/api-client";
import type { SmsAudienceCountResponse, SmsBlastRow, SmsPreviewResponse } from "../lib/types";

// No pipeline-scoped list on this surface (the Audience picker targets leads
// tenant-wide, not one list) — mirrors leads-table.tsx's "no active pipeline"
// fallback (leads-table.tsx:1254-1262) rather than wiring per-pipeline stages.
const STATUS_OPTIONS: FilterOption[] = [
  { value: "all", label: "All Status" },
  { value: "new", label: "New" },
  { value: "partial", label: "Partial" },
  { value: "contacted", label: "Contacted" },
  { value: "enrolled", label: "Enrolled" },
  { value: "rejected", label: "Rejected" },
];

// Matches leads-table.tsx:2318 — the only tag leads-table.tsx offers today.
const TAG_OPTIONS: FilterOption[] = [{ value: "student", label: "Student" }];

/** Pure so the F-11 regression test can assert every key resolves to a
 *  non-empty option list from realistic fixture data without rendering. */
export function buildAudienceOptionOverrides(input: {
  forms: { id: string; name: string }[];
  sourceFacet: { name: string; count: number }[];
  assigneeFacet: { name: string; count: number }[];
  roster: { user_id: string; name: string }[];
  leadLists: { id: string; name: string; is_staging?: boolean; is_archive: boolean }[];
}): Partial<Record<string, FilterOption[]>> {
  const collaborators = input.roster.map((m) => ({ value: m.user_id, label: m.name }));
  const memberNameById = new Map(collaborators.map((o) => [o.value, o.label]));
  return {
    form: input.forms.map((f) => ({ value: f.id, label: f.name })),
    source: input.sourceFacet.map((o) => ({ value: o.name, label: o.name })),
    assignees: input.assigneeFacet
      .filter((o) => o.name !== "unassigned")
      .map((o) => ({ value: o.name, label: memberNameById.get(o.name) ?? o.name })),
    collaborators,
    status: STATUS_OPTIONS,
    industry: PROSPECT_INDUSTRIES.map((ind) => ({ value: ind.value, label: ind.label })),
    tags: TAG_OPTIONS,
    stage: input.leadLists
      .filter((l) => !l.is_staging && !l.is_archive)
      .map((l) => ({ value: l.id, label: l.name })),
  };
}

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
  const [audienceCount, setAudienceCount] = useState<{ matched: number; sendable: number } | null>(null);
  const [audienceCountLoading, setAudienceCountLoading] = useState(false);
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

  // Audience picker option lists (F-11 fix — SMS-FIX-F11-BRIEF.md). This is a
  // from-scratch page with no leads/team data already loaded, unlike
  // leads-table.tsx (the AdvancedFilterBar's only other consumer, which
  // computes these from data it already has). Fetched once on mount from the
  // same existing endpoints/constants leads-table.tsx draws from — no new API.
  const [forms, setForms] = useState<{ id: string; name: string }[]>([]);
  const [sourceFacet, setSourceFacet] = useState<{ name: string; count: number }[]>([]);
  const [assigneeFacet, setAssigneeFacet] = useState<{ name: string; count: number }[]>([]);
  const [roster, setRoster] = useState<{ user_id: string; name: string }[]>([]);
  const [leadLists, setLeadLists] = useState<{ id: string; name: string; is_staging?: boolean; is_archive: boolean }[]>([]);

  useEffect(() => {
    let cancelled = false;

    smsGet<{ id: string; name: string }[]>("/api/v1/form-configs")
      .then(({ data }) => {
        if (!cancelled) setForms(data);
      })
      .catch(() => void 0);

    smsGet<{ id: string; name: string; is_staging?: boolean; is_archive: boolean }[]>("/api/v1/lead-lists")
      .then(({ data }) => {
        if (!cancelled) setLeadLists(data);
      })
      .catch(() => void 0);

    smsGet<{ facets?: { source?: { options: { name: string; count: number }[] } | null; assignee?: { options: { name: string; count: number }[] } | null } }>(
      "/api/v1/leads?facets=source,assignee"
    )
      .then(({ data }) => {
        if (cancelled) return;
        setSourceFacet(data.facets?.source?.options ?? []);
        setAssigneeFacet(data.facets?.assignee?.options ?? []);
      })
      .catch(() => void 0);

    smsGet<{ user_id: string; name: string }[]>("/api/v1/team?minimal=1")
      .then(({ data }) => {
        if (!cancelled) setRoster(data);
      })
      .catch(() => void 0);

    return () => {
      cancelled = true;
    };
  }, []);

  const audienceOptionOverrides = useMemo(
    () => buildAudienceOptionOverrides({ forms, sourceFacet, assigneeFacet, roster, leadLists }),
    [forms, sourceFacet, assigneeFacet, roster, leadLists]
  );

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audienceCountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Audience match count — decoupled from `body` (F-12: SMS-PHASE4-FIX-F12-BRIEF.md).
  // Fires on mount (an empty tree still resolves to "all tenant leads", useful
  // context before any filter is added) and whenever the filter tree changes,
  // independent of whether a message has been typed.
  useEffect(() => {
    setAudienceCountLoading(true);
    if (audienceCountTimer.current) clearTimeout(audienceCountTimer.current);
    audienceCountTimer.current = setTimeout(() => {
      smsSend<SmsAudienceCountResponse>(`/api/v1/sms/blasts/${blast.id}/audience-count`, "POST", { audience_filter: tree })
        .then((r) => setAudienceCount({ matched: r.matched, sendable: r.sendable }))
        .catch(() => void 0)
        .finally(() => setAudienceCountLoading(false));
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (audienceCountTimer.current) clearTimeout(audienceCountTimer.current);
    };
  }, [tree, blast.id]);

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
        <AdvancedFilterBar entity="leads" fields={fields} value={tree} onChange={setTree} allowGroups={false} optionOverrides={audienceOptionOverrides} />
        {audienceCountLoading ? (
          <p className="text-xs text-muted-foreground">Counting matches…</p>
        ) : audienceCount && audienceCount.matched === 0 ? (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-500">No leads match this filter.</p>
        ) : audienceCount ? (
          <p className="text-xs text-muted-foreground">
            {audienceCount.sendable} sendable of {audienceCount.matched} matched leads.
          </p>
        ) : null}
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
