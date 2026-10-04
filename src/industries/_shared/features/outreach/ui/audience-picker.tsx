"use client";

import { useEffect, useMemo, useState } from "react";
import { AdvancedFilterBar } from "@/components/filters/advanced-filter-bar";
import type { FilterOption } from "@/components/filters/types";
import { leadFields } from "@/lib/filters/registry/leads";
import { conditionSchema } from "@/lib/filters/schema";
import { EMPTY_TREE, type CompileCtx, type FilterCondition, type FilterTree } from "@/lib/filters/types";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";
import {
  buildAudienceOptionOverrides,
  buildStageHierarchy,
  withDraft,
  type ComposerLeadList,
} from "@/industries/_shared/features/email-campaigns/ui/blast-composer";

// "Which leads?" for a bulk enroll started from a SEQUENCE (not from ticked rows on the leads list): the same
// advanced filter bar the leads list and Email Campaigns use, with the same option sources (forms, sources,
// assignees, team roster, stages, study taxonomy). The option builders are Email Campaigns' own (exported from
// blast-composer.tsx, unchanged) so the two audiences can't drift.
//
// Emits the EFFECTIVE tree: the committed conditions plus the filter currently being edited, once it is valid
// (same rule the blast composer's count line uses).

interface AudiencePickerProps {
  industryId: string | null;
  isAdmin: boolean;
  onChange: (tree: FilterTree) => void;
}

async function getData<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return ((await res.json()).data ?? null) as T | null;
  } catch {
    return null;
  }
}

export function AudienceFilterPicker({ industryId, isAdmin, onChange }: AudiencePickerProps) {
  const [tree, setTree] = useState<FilterTree>(EMPTY_TREE);
  const [draft, setDraft] = useState<FilterCondition | null>(null);

  const fields = useMemo(
    () =>
      Object.values(
        leadFields({
          tz: "UTC",
          now: new Date(0),
          industryId,
          permissions: {},
        } satisfies CompileCtx),
      ),
    [industryId],
  );

  const [forms, setForms] = useState<{ id: string; name: string }[]>([]);
  const [roster, setRoster] = useState<{ user_id: string; name: string }[]>([]);
  const [leadLists, setLeadLists] = useState<ComposerLeadList[]>([]);
  const [sourceFacet, setSourceFacet] = useState<{ name: string; count: number }[]>([]);
  const [assigneeFacet, setAssigneeFacet] = useState<{ name: string; count: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [f, l, t, facets] = await Promise.all([
        getData<{ id: string; name: string }[]>("/api/v1/form-configs"),
        getData<ComposerLeadList[]>("/api/v1/lead-lists"),
        getData<{ user_id: string; name: string }[]>("/api/v1/team?minimal=1"),
        // facets sit under data.facets, not data
        fetch("/api/v1/leads?facets=source,assignee")
          .then((r) => (r.ok ? r.json() : null))
          .then(
            (j) =>
              (j?.data?.facets ?? null) as {
                source?: { options: { name: string; count: number }[] } | null;
                assignee?: {
                  options: { name: string; count: number }[];
                } | null;
              } | null,
          )
          .catch(() => null),
      ]);
      if (cancelled) return;
      setForms(f ?? []);
      setLeadLists(l ?? []);
      setRoster(t ?? []);
      setSourceFacet(facets?.source?.options ?? []);
      setAssigneeFacet(facets?.assignee?.options ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { fieldsOfStudy, studyLevels } = useEduTaxonomy();
  const optionOverrides = useMemo<Partial<Record<string, FilterOption[]>>>(
    () =>
      buildAudienceOptionOverrides({
        forms,
        sourceFacet,
        assigneeFacet,
        roster,
        leadLists,
        fieldsOfStudy,
        studyLevels,
      }),
    [forms, sourceFacet, assigneeFacet, roster, leadLists, fieldsOfStudy, studyLevels],
  );
  const hierarchicalGroups = useMemo(() => ({ stage: buildStageHierarchy(leadLists, isAdmin) }), [leadLists, isAdmin]);

  const draftValid = draft ? conditionSchema.safeParse(draft).success : false;
  useEffect(() => {
    onChange(withDraft(tree, draftValid ? draft : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, draft, draftValid]);

  return (
    <AdvancedFilterBar
      entity="leads"
      fields={fields}
      value={tree}
      onChange={setTree}
      allowGroups={false}
      optionOverrides={optionOverrides}
      onDraftConditionChange={setDraft}
      hierarchicalGroups={hierarchicalGroups}
    />
  );
}
