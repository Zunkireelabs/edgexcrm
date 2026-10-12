import { describe, it, expect } from "vitest";
import { resolveRestoreTarget, type RestoreList, type RestoreStage } from "./restore-target";

// Where an archived lead goes when it is sent back to the pipeline. Pure — no DB.

const list = (over: Partial<RestoreList> & { id: string }): RestoreList => ({
  name: over.id,
  slug: over.id,
  is_archive: false,
  is_intake: false,
  is_staging: false,
  pipeline_id: null,
  sort_order: 0,
  ...over,
});
const stage = (over: Partial<RestoreStage> & { id: string; pipeline_id: string }): RestoreStage => ({
  slug: over.id,
  position: 0,
  is_default: false,
  ...over,
});

const LISTS: RestoreList[] = [
  list({ id: "pre", name: "Pre-qualified", slug: "pre-qualified", is_intake: true, sort_order: 1, pipeline_id: "p-pre" }),
  list({ id: "qual", name: "Qualified", slug: "qualified", sort_order: 2, pipeline_id: "p-qual" }),
  list({ id: "pros", name: "Prospects", slug: "prospects", sort_order: 3, pipeline_id: "p-pros" }),
  list({ id: "arch", name: "Archived", slug: "archived", is_archive: true, sort_order: 4 }),
  list({ id: "qc", name: "Migration QC", slug: "migration-qc", is_staging: true, sort_order: 5 }),
];
const STAGES: RestoreStage[] = [
  stage({ id: "s-new", slug: "new", pipeline_id: "p-qual", position: 1, is_default: true }),
  stage({ id: "s-contacted", slug: "contacted", pipeline_id: "p-qual", position: 2 }),
  stage({ id: "s-pre-new", slug: "new", pipeline_id: "p-pre", position: 1, is_default: true }),
  stage({ id: "s-pros-a", slug: "applying", pipeline_id: "p-pros", position: 1 }),
  stage({ id: "s-pros-b", slug: "offered", pipeline_id: "p-pros", position: 2 }),
];

describe("resolveRestoreTarget", () => {
  it("returns the lead to the stage it was archived from, at the status it had", () => {
    const t = resolveRestoreTarget({ archivedFromListId: "qual", archivedFromStatus: "contacted", lists: LISTS, stages: STAGES });
    expect(t).toMatchObject({ listId: "qual", listName: "Qualified", stageId: "s-contacted", status: "contacted", pipelineId: "p-qual", usedFallback: false });
  });

  it("falls back to the pipeline's landing stage when the remembered status no longer exists", () => {
    const t = resolveRestoreTarget({ archivedFromListId: "qual", archivedFromStatus: "deleted-status", lists: LISTS, stages: STAGES });
    expect(t).toMatchObject({ listId: "qual", stageId: "s-new", status: "new", usedFallback: false });
  });

  it("picks the default-flagged stage first, then the lowest position (no default flag)", () => {
    const t = resolveRestoreTarget({ archivedFromListId: "pros", archivedFromStatus: null, lists: LISTS, stages: STAGES });
    expect(t).toMatchObject({ listId: "pros", stageId: "s-pros-a", status: "applying" });
  });

  it("goes to the first intake stage when the original list is gone", () => {
    const t = resolveRestoreTarget({ archivedFromListId: "deleted-list", archivedFromStatus: "contacted", lists: LISTS, stages: STAGES });
    expect(t).toMatchObject({ listId: "pre", listName: "Pre-qualified", usedFallback: true });
  });

  it("goes to the first intake stage when the lead has no remembered origin (archived before the snapshot existed)", () => {
    const t = resolveRestoreTarget({ archivedFromListId: null, archivedFromStatus: null, lists: LISTS, stages: STAGES });
    expect(t).toMatchObject({ listId: "pre", usedFallback: true, stageId: "s-pre-new" });
  });

  it("never reuses a remembered status on the fallback list (it belonged to another pipeline)", () => {
    const t = resolveRestoreTarget({ archivedFromListId: "deleted-list", archivedFromStatus: "contacted", lists: LISTS, stages: STAGES });
    expect(t?.status).toBe("new");
  });

  it("will not 'restore' into an archive or a staging list — it falls back instead", () => {
    for (const origin of ["arch", "qc"]) {
      const t = resolveRestoreTarget({ archivedFromListId: origin, archivedFromStatus: "x", lists: LISTS, stages: STAGES });
      expect(t).toMatchObject({ listId: "pre", usedFallback: true });
    }
  });

  it("with no intake stage, falls back to the first funnel stage by order", () => {
    const noIntake = LISTS.map((l) => ({ ...l, is_intake: false }));
    const t = resolveRestoreTarget({ archivedFromListId: null, archivedFromStatus: null, lists: noIntake, stages: STAGES });
    expect(t?.listId).toBe("pre");
  });

  it("sets lead_type to prospect only for the Prospects stage", () => {
    expect(resolveRestoreTarget({ archivedFromListId: "pros", archivedFromStatus: null, lists: LISTS, stages: STAGES })?.leadType).toBe("prospect");
    expect(resolveRestoreTarget({ archivedFromListId: "qual", archivedFromStatus: null, lists: LISTS, stages: STAGES })?.leadType).toBe("lead");
  });

  it("a list with no pipeline restores with no stage fields (nothing to set)", () => {
    const lists = [list({ id: "plain", slug: "plain", sort_order: 1, pipeline_id: null })];
    const t = resolveRestoreTarget({ archivedFromListId: "plain", archivedFromStatus: "x", lists, stages: [] });
    expect(t).toMatchObject({ listId: "plain", pipelineId: null, stageId: null, status: null });
  });

  it("returns null when the tenant has no funnel stage at all", () => {
    const only = LISTS.filter((l) => l.is_archive || l.is_staging);
    expect(resolveRestoreTarget({ archivedFromListId: null, archivedFromStatus: null, lists: only, stages: STAGES })).toBeNull();
  });
});
