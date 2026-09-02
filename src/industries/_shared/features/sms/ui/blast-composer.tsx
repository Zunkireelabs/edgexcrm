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
import type { FilterOption, HierarchicalFieldGroups } from "@/components/filters/types";
import { leadFields } from "@/lib/filters/registry/leads";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";
import { EMPTY_TREE, type CompileCtx, type FilterCondition, type FilterTree } from "@/lib/filters/types";
import { conditionSchema } from "@/lib/filters/schema";
import { PROSPECT_INDUSTRIES } from "@/industries/it-agency/leads/prospect-industries";
import { isOffFunnelLeadList } from "@/lib/leads/list-funnel";
import { CharacterCounter } from "./character-counter";
import { CostPreviewDialog } from "./cost-preview-dialog";
import { RecipientsPreviewDialog } from "./recipients-preview-dialog";
import { SendConfirmDialog } from "./send-confirm-dialog";
import { smsSend, smsGet, SmsApiError } from "../lib/api-client";
import type { SmsAudienceCountResponse, SmsBlastRow, SmsPreviewResponse, SmsSettings } from "../lib/types";

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

/** Renders the persistent audience-count line's "incl. X, Y, Z" clause.
 *  Pure so the Phase 3 regression test can assert the branch logic without
 *  rendering. Caller handles the `matched === 0` amber-empty-state branch
 *  separately — this only covers the sendable > 0 cases. */
export function formatAudienceCountLine(audienceCount: { matched: number; sendable: number; sampleNames: string[] }): string {
  const { matched, sendable, sampleNames } = audienceCount;
  if (sampleNames.length === 0) {
    return `${sendable} sendable of ${matched} matched leads.`;
  }
  const remainder = matched - sampleNames.length;
  return `${sendable} sendable of ${matched} matched — incl. ${sampleNames.join(", ")}${remainder > 0 ? `, +${remainder} more` : ""}.`;
}

/** Folds an in-progress draft condition into a committed tree by `id`:
 *  replaces the condition being edited (FilterChip drafts carry their
 *  original id) or appends a brand-new one (AddFilterButton drafts have a
 *  fresh id not yet in `tree.conditions`). Null draft is a no-op. */
export function withDraft(tree: FilterTree, draft: FilterCondition | null): FilterTree {
  if (!draft) return tree;
  const exists = tree.conditions.some((c) => c.id === draft.id);
  return {
    ...tree,
    conditions: exists
      ? tree.conditions.map((c) => (c.id === draft.id ? draft : c))
      : [...tree.conditions, draft],
  };
}

type ComposerLeadList = { id: string; name: string; slug: string; is_staging?: boolean; is_archive: boolean };

/** Which of the 4 picker categories a lead list belongs to — drives the
 *  chip's prefix label (FilterOption.groupLabel, resolved by
 *  resolvePrefixLabel in chip-label.ts) so a Leads Organize pick reads
 *  "Leads Organize: X", not the shared field's generic "Stage: X". Mirrors
 *  the email-campaigns composer's stageGroupLabel (#454) — same bug, same
 *  fix, SMS side. Order matters: Archive/Delete are also off-funnel, so
 *  they're checked before the generic isOffFunnelLeadList fallback. */
function stageGroupLabel(list: ComposerLeadList): string {
  if (list.is_staging) return "Leads Organize";
  if (list.is_archive) return "Archive";
  if (list.slug === "delete") return "Delete";
  return "Stage";
}

/** Pure so the F-11 regression test can assert every key resolves to a
 *  non-empty option list from realistic fixture data without rendering. */
export function buildAudienceOptionOverrides(input: {
  forms: { id: string; name: string }[];
  sourceFacet: { name: string; count: number }[];
  assigneeFacet: { name: string; count: number }[];
  roster: { user_id: string; name: string }[];
  leadLists: ComposerLeadList[];
  fieldsOfStudy: string[];
  studyLevels: string[];
}): Partial<Record<string, FilterOption[]>> {
  const collaborators = input.roster.map((m) => ({ value: m.user_id, label: m.name }));
  const memberNameById = new Map(collaborators.map((o) => [o.value, o.label]));
  return {
    form: input.forms.map((f) => ({ value: f.id, label: f.name })),
    // field_of_study/degree_level: registry() below always passes industryId:
    // "education_consultancy" (this feature is education-only per meta.ts),
    // so both fields are always offered — same Settings-catalog source as
    // leads-table.tsx, fetched via useEduTaxonomy() below.
    field_of_study: input.fieldsOfStudy.map((name) => ({ value: name, label: name })),
    degree_level: input.studyLevels.map((name) => ({ value: name, label: name })),
    source: input.sourceFacet.map((o) => ({ value: o.name, label: o.name })),
    assignees: input.assigneeFacet
      .filter((o) => o.name !== "unassigned")
      .map((o) => ({ value: o.name, label: memberNameById.get(o.name) ?? o.name })),
    collaborators,
    status: STATUS_OPTIONS,
    industry: PROSPECT_INDUSTRIES.map((ind) => ({ value: ind.value, label: ind.label })),
    tags: TAG_OPTIONS,
    // Every lead list, unfiltered — Stage, Leads Organize, Archive, and
    // Delete all commit as { field: "stage", value: <list_id> } (see
    // buildAudienceOptionOverrides' email-campaigns twin, #454). Narrowing
    // this to only the 4 pipeline-stage lists (as it used to be) meant a
    // Leads Organize / Archive / Delete list was never even offered as a
    // Stage option here — SMS has no separate hierarchical picker the way
    // email does, so this flat array IS the only source of Stage choices.
    // groupLabel tags each option purely for chip/panel display; the
    // committed condition is still always { field: "stage", value: l.id }.
    stage: input.leadLists.map((l) => ({ value: l.id, label: l.name, groupLabel: stageGroupLabel(l) })),
  };
}

/** "Leads Organize" (is_staging=true) vs "Stage" (is_staging=false, each
 *  expandable to STATUS_OPTIONS) groups for the "Add filter" picker's stage
 *  field — mirrors the leads-page sidebar grouping. Ported verbatim from the
 *  email-campaigns composer's buildStageHierarchy (#454) now that this
 *  composer has the same is_staging/is_archive/slug data (#465) to build it
 *  from — brings the SMS "Add filter" menu to parity with email's. */
function buildStageHierarchy(leadLists: ComposerLeadList[], isAdmin: boolean): HierarchicalFieldGroups {
  const statusLeaves = STATUS_OPTIONS.filter((o) => o.value !== "all").map((o) => ({ value: o.value, label: o.label }));
  const archiveList = leadLists.find((l) => !l.is_staging && l.is_archive === true);
  const deleteList = leadLists.find((l) => !l.is_staging && l.slug === "delete");
  return {
    orgLists: isAdmin ? leadLists.filter((l) => l.is_staging && !l.is_archive).map((l) => ({ value: l.id, label: l.name })) : [],
    stages: leadLists
      .filter((l) => !l.is_staging && !isOffFunnelLeadList(l))
      .map((l) => ({ value: l.id, label: l.name, statusOptions: statusLeaves })),
    archive: archiveList ? { value: archiveList.id, label: archiveList.name } : null,
    deleteList: deleteList ? { value: deleteList.id, label: deleteList.name } : null,
  };
}

interface BlastComposerProps {
  blast: SmsBlastRow;
  onSent: () => void;
  canSendSms: boolean;
  sandboxed: boolean;
  isAdmin: boolean;
}

const AUTOSAVE_DEBOUNCE_MS = 800;
const PREVIEW_DEBOUNCE_MS = 600;

export function BlastComposer({ blast, onSent, canSendSms, sandboxed, isAdmin }: BlastComposerProps) {
  const router = useRouter();

  const [name, setName] = useState(blast.name);
  const [body, setBody] = useState(blast.body);
  const [tree, setTree] = useState<FilterTree>(blast.audience_filter ?? EMPTY_TREE);
  const [draftCondition, setDraftCondition] = useState<FilterCondition | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const [liveMeta, setLiveMeta] = useState<{ prefix: string; footer: string; sendable: number; matched: number } | null>(null);
  const [audienceCount, setAudienceCount] = useState<{ matched: number; sendable: number; sampleNames: string[] } | null>(null);
  const [audienceCountLoading, setAudienceCountLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recipientsPreviewOpen, setRecipientsPreviewOpen] = useState(false);
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
  const [leadLists, setLeadLists] = useState<ComposerLeadList[]>([]);
  // Tenant's per-blast recipient cap (max_recipients_per_blast, admin-
  // configurable 1-20,000, default 500 — SMS-PHASE3A-BRIEF.md §4). Fetched so
  // the audience count line below can warn BEFORE Review & send, instead of
  // the only signal being the server's 422 MAX_RECIPIENTS_EXCEEDED after the
  // user has already gone through the full confirm flow (the actual client
  // complaint: they only found out they were over the cap at the very last
  // step, with no way to see it coming while still adjusting filters).
  const [smsSettings, setSmsSettings] = useState<SmsSettings | null>(null);

  useEffect(() => {
    let cancelled = false;

    smsGet<{ id: string; name: string }[]>("/api/v1/form-configs")
      .then(({ data }) => {
        if (!cancelled) setForms(data);
      })
      .catch(() => void 0);

    smsGet<ComposerLeadList[]>("/api/v1/lead-lists")
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

    smsGet<SmsSettings>("/api/v1/sms/settings")
      .then(({ data }) => {
        if (!cancelled) setSmsSettings(data);
      })
      .catch(() => void 0);

    return () => {
      cancelled = true;
    };
  }, []);

  const { fieldsOfStudy: eduFieldsOfStudy, studyLevels: eduStudyLevels } = useEduTaxonomy();
  const audienceOptionOverrides = useMemo(
    () => buildAudienceOptionOverrides({ forms, sourceFacet, assigneeFacet, roster, leadLists, fieldsOfStudy: eduFieldsOfStudy, studyLevels: eduStudyLevels }),
    [forms, sourceFacet, assigneeFacet, roster, leadLists, eduFieldsOfStudy, eduStudyLevels]
  );
  const hierarchicalGroups = useMemo(() => ({ stage: buildStageHierarchy(leadLists, isAdmin) }), [leadLists, isAdmin]);

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
  // independent of whether a message has been typed. F-13
  // (SMS-PHASE4-FIX-F13-BRIEF.md) additionally folds in the in-progress draft
  // condition (still open in its popover, not yet Applied) once it's valid,
  // so the count previews what Apply would produce instead of going stale
  // while the user is mid-edit.
  const isDraftValid = draftCondition ? conditionSchema.safeParse(draftCondition).success : false;
  useEffect(() => {
    setAudienceCountLoading(true);
    if (audienceCountTimer.current) clearTimeout(audienceCountTimer.current);
    audienceCountTimer.current = setTimeout(() => {
      const previewTree = withDraft(tree, isDraftValid ? draftCondition : null);
      smsSend<SmsAudienceCountResponse>(`/api/v1/sms/blasts/${blast.id}/audience-count`, "POST", { audience_filter: previewTree })
        .then((r) => setAudienceCount({ matched: r.matched, sendable: r.sendable, sampleNames: r.sampleNames }))
        .catch(() => void 0)
        .finally(() => setAudienceCountLoading(false));
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (audienceCountTimer.current) clearTimeout(audienceCountTimer.current);
    };
  }, [tree, blast.id, draftCondition, isDraftValid]);

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

  // Null max_recipients_per_blast (settings not loaded yet) never blocks
  // sending — this is an early-warning UX layer on top of the server's real
  // enforcement (send/route.ts's MAX_RECIPIENTS_EXCEEDED), not a replacement
  // for it, so a slow/failed settings fetch fails open here and still gets
  // caught server-side.
  const recipientCap = smsSettings?.max_recipients_per_blast ?? null;
  const overCapBy = recipientCap !== null && audienceCount ? audienceCount.sendable - recipientCap : 0;
  const isOverCap = overCapBy > 0;

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
        <AdvancedFilterBar
          entity="leads"
          fields={fields}
          value={tree}
          onChange={setTree}
          allowGroups={false}
          optionOverrides={audienceOptionOverrides}
          onDraftConditionChange={setDraftCondition}
          hierarchicalGroups={hierarchicalGroups}
        />
        {audienceCountLoading ? (
          <p className="text-xs text-muted-foreground">Counting matches…</p>
        ) : audienceCount && audienceCount.matched === 0 ? (
          <p className="text-xs font-medium text-amber-600 dark:text-amber-500">No leads match this filter.</p>
        ) : audienceCount ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">{formatAudienceCountLine(audienceCount)}</p>
              {audienceCount.sendable > 0 && (
                <button
                  type="button"
                  onClick={() => setRecipientsPreviewOpen(true)}
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  Preview recipients
                </button>
              )}
            </div>
            {isOverCap && (
              <p className="text-xs font-medium text-destructive">
                Exceeds this tenant&apos;s {recipientCap}-recipient cap by {overCapBy} — narrow your filter to send, or ask an
                owner/admin to raise the cap in SMS Settings.
              </p>
            )}
          </div>
        ) : null}
      </div>

      {canSendSms && (
        <div className="flex items-center gap-2">
          <Button onClick={() => setPreviewOpen(true)} disabled={!body.trim() || isOverCap}>
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

      <RecipientsPreviewDialog
        open={recipientsPreviewOpen}
        onOpenChange={setRecipientsPreviewOpen}
        blastId={blast.id}
        audienceFilter={tree}
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
