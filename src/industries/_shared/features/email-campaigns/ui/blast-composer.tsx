"use client";

// Draft-blast composer (OUTREACH-PHASE1-BRIEF.md §7.4). Reuses the existing
// advanced-filter builder for the audience — no second filter UI — mirrors
// src/industries/_shared/features/sms/ui/blast-composer.tsx's shape almost
// exactly; the differences are email-specific fields (subject, HTML body,
// from-name override) and no character/credit counter (email has none).
//
// The HTML body reuses HtmlSourceEditor (built for confirmation emails +
// email rules, #435) with the format toggle hidden — body_template is
// always HTML here, no rich-text/plain-text ambiguity to disambiguate. The
// live sample preview (rendered by /preview) is still what shows the actual
// recipient result; the editor's own preview tab is structural-only.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HtmlSourceEditor } from "@/industries/_shared/features/email/components/html-source-editor";
import { Button } from "@/components/ui/button";
import { AdvancedFilterBar } from "@/components/filters/advanced-filter-bar";
import type { FilterOption, HierarchicalFieldGroups } from "@/components/filters/types";
import { leadFields } from "@/lib/filters/registry/leads";
import { isOffFunnelLeadList } from "@/lib/leads/list-funnel";
import { EMPTY_TREE, type CompileCtx, type FilterCondition, type FilterTree } from "@/lib/filters/types";
import { conditionSchema } from "@/lib/filters/schema";
import { PROSPECT_INDUSTRIES } from "@/industries/it-agency/leads/prospect-industries";
import { RecipientsPreviewDialog } from "./recipients-preview-dialog";
import { SendConfirmDialog } from "./send-confirm-dialog";
import { emailBlastSend, emailBlastGet, EmailBlastApiError } from "../lib/api-client";
import type { EmailBlastAudienceCountResponse, EmailBlastRow, EmailBlastPreviewResponse } from "../lib/types";

// Same fallback options as the SMS composer — no per-pipeline list on this
// surface, and the same status/tag vocabulary leads-table.tsx offers.
const STATUS_OPTIONS: FilterOption[] = [
  { value: "all", label: "All Status" },
  { value: "new", label: "New" },
  { value: "partial", label: "Partial" },
  { value: "contacted", label: "Contacted" },
  { value: "enrolled", label: "Enrolled" },
  { value: "rejected", label: "Rejected" },
];
const TAG_OPTIONS: FilterOption[] = [{ value: "student", label: "Student" }];

/** Renders the persistent audience-count line's "incl. X, Y, Z" clause.
 *  Mirrors src/industries/_shared/features/sms/ui/blast-composer.tsx's
 *  formatAudienceCountLine — small enough (and channel-agnostic enough) that
 *  duplicating it here beats importing across feature-UI boundaries. */
export function formatAudienceCountLine(audienceCount: { matched: number; sendable: number; sampleNames: string[] }): string {
  const { matched, sendable, sampleNames } = audienceCount;
  if (sampleNames.length === 0) {
    return `${sendable} sendable of ${matched} matched leads.`;
  }
  const remainder = matched - sampleNames.length;
  return `${sendable} sendable of ${matched} matched — incl. ${sampleNames.join(", ")}${remainder > 0 ? `, +${remainder} more` : ""}.`;
}

/** Folds an in-progress draft condition into a committed tree by `id`. */
export function withDraft(tree: FilterTree, draft: FilterCondition | null): FilterTree {
  if (!draft) return tree;
  const exists = tree.conditions.some((c) => c.id === draft.id);
  return {
    ...tree,
    conditions: exists ? tree.conditions.map((c) => (c.id === draft.id ? draft : c)) : [...tree.conditions, draft],
  };
}

type ComposerLeadList = { id: string; name: string; slug: string; is_staging?: boolean; is_archive: boolean };

/** Which of the 4 picker categories a lead list belongs to — drives the
 *  chip's prefix label (FilterOption.groupLabel, resolved by
 *  resolvePrefixLabel in chip-label.ts) so a Leads Organize pick reads
 *  "Leads Organize: X", not the shared field's generic "Stage: X". Order
 *  matters: Archive/Delete are also off-funnel, so they're checked before
 *  the generic isOffFunnelLeadList fallback. */
function stageGroupLabel(list: ComposerLeadList): string {
  if (list.is_staging) return "Leads Organize";
  if (list.is_archive) return "Archive";
  if (list.slug === "delete") return "Delete";
  return "Stage";
}

function buildAudienceOptionOverrides(input: {
  forms: { id: string; name: string }[];
  sourceFacet: { name: string; count: number }[];
  assigneeFacet: { name: string; count: number }[];
  roster: { user_id: string; name: string }[];
  leadLists: ComposerLeadList[];
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
    // Every lead list, unfiltered — this is the label/lookup source for the
    // "stage" field's committed chips (Stage, Leads Organize, Archive, and
    // Delete all commit as { field: "stage", value: <list_id> }; see
    // buildStageHierarchy below). Narrowing this to only the 4 pipeline-stage
    // lists (as it used to be) meant any Leads Organize / Archive / Delete
    // pick had no matching option: formatChipLabel fell back to printing the
    // raw list_id UUID on the chip, and reopening that chip rendered
    // FilterConditionEditor with none of its radio options selected (looked
    // like the pick had reverted to a blank "Stage" panel). What's initially
    // OFFERED when adding a new filter is still governed separately by
    // buildStageHierarchy's own (narrower, isAdmin-aware) filtering — this
    // array only has to be able to NAME and RE-SELECT whatever was already
    // picked, so it must be the full set. groupLabel tags each option with
    // which of the 4 picker categories it came from, purely for chip/panel
    // display (resolvePrefixLabel) — the committed condition is still always
    // { field: "stage", value: l.id } underneath, unaffected by this tag.
    stage: input.leadLists.map((l) => ({ value: l.id, label: l.name, groupLabel: stageGroupLabel(l) })),
  };
}

/** "Leads Organize" (is_staging=true) vs "Stage" (is_staging=false, each
 *  expandable to STATUS_OPTIONS) groups for the "Add filter" picker's stage
 *  field — mirrors the leads-page sidebar grouping. Email-blast composer
 *  only; SMS composer and leads-table keep the flat picker unaffected. */
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
  blast: EmailBlastRow;
  onSent: () => void;
  canSendEmail: boolean;
  isAdmin: boolean;
}

const AUTOSAVE_DEBOUNCE_MS = 800;
const PREVIEW_DEBOUNCE_MS = 600;

export function BlastComposer({ blast, onSent, canSendEmail, isAdmin }: BlastComposerProps) {
  const router = useRouter();

  const [name, setName] = useState(blast.name);
  const [subject, setSubject] = useState(blast.subject_template);
  const [body, setBody] = useState(blast.body_template);
  const [fromNameOverride, setFromNameOverride] = useState(blast.from_name_override ?? "");
  const [tree, setTree] = useState<FilterTree>(blast.audience_filter ?? EMPTY_TREE);
  const [draftCondition, setDraftCondition] = useState<FilterCondition | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const [audienceCount, setAudienceCount] = useState<{ matched: number; sendable: number; sampleNames: string[] } | null>(null);
  const [audienceCountLoading, setAudienceCountLoading] = useState(false);
  const [recipientsPreviewOpen, setRecipientsPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<EmailBlastPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const registry = useMemo(
    () => leadFields({ tz: "UTC", now: new Date(0), industryId: "education_consultancy", permissions: {} } satisfies CompileCtx),
    []
  );
  const fields = useMemo(() => Object.values(registry), [registry]);

  const [forms, setForms] = useState<{ id: string; name: string }[]>([]);
  const [sourceFacet, setSourceFacet] = useState<{ name: string; count: number }[]>([]);
  const [assigneeFacet, setAssigneeFacet] = useState<{ name: string; count: number }[]>([]);
  const [roster, setRoster] = useState<{ user_id: string; name: string }[]>([]);
  const [leadLists, setLeadLists] = useState<{ id: string; name: string; slug: string; is_staging?: boolean; is_archive: boolean }[]>([]);

  useEffect(() => {
    let cancelled = false;

    emailBlastGet<{ id: string; name: string }[]>("/api/v1/form-configs")
      .then(({ data }) => {
        if (!cancelled) setForms(data);
      })
      .catch(() => void 0);

    emailBlastGet<{ id: string; name: string; slug: string; is_staging?: boolean; is_archive: boolean }[]>("/api/v1/lead-lists")
      .then(({ data }) => {
        if (!cancelled) setLeadLists(data);
      })
      .catch(() => void 0);

    emailBlastGet<{
      facets?: { source?: { options: { name: string; count: number }[] } | null; assignee?: { options: { name: string; count: number }[] } | null };
    }>("/api/v1/leads?facets=source,assignee")
      .then(({ data }) => {
        if (cancelled) return;
        setSourceFacet(data.facets?.source?.options ?? []);
        setAssigneeFacet(data.facets?.assignee?.options ?? []);
      })
      .catch(() => void 0);

    emailBlastGet<{ user_id: string; name: string }[]>("/api/v1/team?minimal=1")
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
  const hierarchicalGroups = useMemo(() => ({ stage: buildStageHierarchy(leadLists, isAdmin) }), [leadLists, isAdmin]);

  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audienceCountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autosave — same posture as the SMS composer: the parent only mounts this
  // component while blast.status === "draft".
  useEffect(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      setSaving(true);
      emailBlastSend<EmailBlastRow>(`/api/v1/email-blasts/${blast.id}`, "PATCH", {
        name,
        subject_template: subject,
        body_template: body,
        from_name_override: fromNameOverride.trim() || null,
        audience_filter: tree,
      })
        .then(() => setSavedAt(new Date()))
        .catch((e: EmailBlastApiError) => toast.error(`Autosave failed: ${e.message}`))
        .finally(() => setSaving(false));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, subject, body, fromNameOverride, tree]);

  // Audience match count — decoupled from subject/body, same F-12/F-13
  // posture as the SMS composer: fires on mount and whenever the filter tree
  // (including an in-progress draft condition, once valid) changes.
  const isDraftValid = draftCondition ? conditionSchema.safeParse(draftCondition).success : false;
  useEffect(() => {
    setAudienceCountLoading(true);
    if (audienceCountTimer.current) clearTimeout(audienceCountTimer.current);
    audienceCountTimer.current = setTimeout(() => {
      const previewTree = withDraft(tree, isDraftValid ? draftCondition : null);
      emailBlastSend<EmailBlastAudienceCountResponse>(`/api/v1/email-blasts/${blast.id}/audience-count`, "POST", { audience_filter: previewTree })
        .then((r) => setAudienceCount({ matched: r.matched, sendable: r.sendable, sampleNames: r.sampleNames }))
        .catch(() => void 0)
        .finally(() => setAudienceCountLoading(false));
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (audienceCountTimer.current) clearTimeout(audienceCountTimer.current);
    };
  }, [tree, blast.id, draftCondition, isDraftValid]);

  async function openReviewAndSend() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const p = await emailBlastSend<EmailBlastPreviewResponse>(`/api/v1/email-blasts/${blast.id}/preview`, "POST", {
        subject_template: subject,
        body_template: body,
        audience_filter: tree,
      });
      setPreview(p);
      setSendError(null);
      setConfirmOpen(true);
    } catch (e) {
      setPreviewError(e instanceof EmailBlastApiError ? e.message : "Failed to build preview.");
      toast.error(previewError ?? "Failed to build preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleConfirmSend() {
    setSending(true);
    setSendError(null);
    try {
      await emailBlastSend(`/api/v1/email-blasts/${blast.id}/send`, "POST");
      toast.success("Blast queued for send.");
      setConfirmOpen(false);
      onSent();
      router.refresh();
    } catch (e) {
      setSendError(e instanceof EmailBlastApiError ? e.message : "Failed to send blast.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="blast-name">Blast name</Label>
        <Input id="blast-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. August intake reminder" disabled={!canSendEmail} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="blast-from-name">From name (optional)</Label>
        <Input
          id="blast-from-name"
          value={fromNameOverride}
          onChange={(e) => setFromNameOverride(e.target.value)}
          placeholder="Leave blank to use the tenant default"
          disabled={!canSendEmail}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="blast-subject">Subject</Label>
        <Input id="blast-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Hi {{first_name}}, …" disabled={!canSendEmail} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="blast-body">Body (HTML)</Label>
        <HtmlSourceEditor
          value={body}
          onChange={setBody}
          placeholder="<p>Hi {{first_name}}, …</p>"
          format="html"
          onFormatChange={() => void 0}
          showFormatToggle={false}
          disabled={!canSendEmail}
        />
        <p className="text-xs text-muted-foreground">{saving ? "Saving…" : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : "Draft"}</p>
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
        ) : null}
      </div>

      {canSendEmail && (
        <div className="flex items-center gap-2">
          <Button onClick={openReviewAndSend} disabled={!subject.trim() || !body.trim() || previewLoading}>
            {previewLoading ? "Preparing…" : "Review & send"}
          </Button>
        </div>
      )}

      <RecipientsPreviewDialog open={recipientsPreviewOpen} onOpenChange={setRecipientsPreviewOpen} blastId={blast.id} audienceFilter={tree} />

      <SendConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        preview={preview}
        sending={sending}
        error={sendError}
        onConfirm={handleConfirmSend}
      />
    </div>
  );
}
