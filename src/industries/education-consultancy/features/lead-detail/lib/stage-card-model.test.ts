import { describe, it, expect } from "vitest";
import { buildStageCardModel, type StageCardInput } from "./stage-card-model";
import type { LeadList } from "@/types/database";

const mk = (slug: string, name: string, sort_order: number, extra: Partial<LeadList> = {}): LeadList =>
  ({ id: slug, tenant_id: "t", name, slug, sort_order, is_system: false, is_archive: false, is_intake: false, color: null, access: { mode: "all" }, pipeline_id: null, funnel_key: null, created_at: "", updated_at: "", ...extra }) as LeadList;
const LISTS = [mk("pre-qualified", "Pre-qualified", 1, { is_intake: true }), mk("qualified", "Qualified", 2), mk("prospects", "Prospects", 3), mk("applications", "Applications", 4)];

const base = (over: Partial<StageCardInput> = {}): StageCardInput => ({
  isOtherContact: false, activeLists: LISTS, accessibleLists: LISTS, currentListId: "prospects", isArchived: false,
  canMoveWithoutChain: false, revertTargetUserId: "u1", canWork: true, hasQualification: false,
  readiness: { ready: false, missing: ["Processing fee", "Consent signed"] }, consentEnabled: true, consentSigned: false,
  feeStatus: null, feeAmount: null, ...over,
});

describe("stage card: segments", () => {
  it("marks earlier stages done, the current one current, the rest later, with the mockup colours", () => {
    const m = buildStageCardModel(base());
    expect(m.segments.map((s) => s.state)).toEqual(["done", "done", "current", "later"]);
    expect(m.segments.map((s) => s.color)).toEqual(["#6366f1", "#3b82f6", "#f97316", "#22c55e"]);
  });
  it("shows no card for Other-tagged contacts", () => expect(buildStageCardModel(base({ isOtherContact: true })).hidden).toBe(true));
});

describe("stage card: Pre-qualified", () => {
  const m = buildStageCardModel(base({ currentListId: "pre-qualified" }));
  it("shows the Qualify hint and button, no requirement rows", () => {
    expect(m.hint).toMatch(/At least a country or a course/);
    expect(m.requirements).toEqual([]);
    expect(m.main).toMatchObject({ kind: "qualify", label: "Qualify", enabled: true });
  });
  it("chain first holder: Revert does not exist (no previous list)", () => expect(m.footer.revert.show).toBe(false));
});

describe("stage card: Qualified", () => {
  it("asks for the +2/Bachelor/Masters %/GPA with an Add link and a Send button for the chain", () => {
    const m = buildStageCardModel(base({ currentListId: "qualified" }));
    expect(m.requirements).toMatchObject([{ id: "qualification", ok: false, actionLabel: "Add" }]);
    expect(m.progress).toBe("0 of 1 done");
    expect(m.main).toMatchObject({ kind: "send", label: "Send to Prospects", enabled: true });
  });
  it("is done and says Move to for admin / branch manager", () => {
    const m = buildStageCardModel(base({ currentListId: "qualified", canMoveWithoutChain: true, hasQualification: true }));
    expect(m.requirements[0]).toMatchObject({ ok: true });
    expect(m.progress).toBe("1 of 1 done");
    expect(m.main.label).toBe("Move to Prospects");
  });
});

describe("stage card: Prospects → Applications", () => {
  it("lists the readiness items, links the open ones and disables the button with the reasons", () => {
    const m = buildStageCardModel(base());
    expect(m.requirements.map((r) => [r.id, r.ok, r.actionLabel])).toEqual([["basic-info", true, undefined], ["fee", false, "Record"], ["consent", false, "Copy link"]]);
    expect(m.progress).toBe("1 of 3 done");
    expect(m.main.enabled).toBe(false);
    expect(m.main.disabledReason).toContain("Processing fee");
  });
  it("hides the consent row when the tenant has no active consent template", () => {
    const m = buildStageCardModel(base({ consentEnabled: false, readiness: { ready: false, missing: ["Processing fee"] } }));
    expect(m.requirements.map((r) => r.id)).toEqual(["basic-info", "fee"]);
  });
  it("enables the button when everything is ready", () => {
    const m = buildStageCardModel(base({ readiness: { ready: true, missing: [] }, feeStatus: "paid", feeAmount: 5000, consentSigned: true }));
    expect(m.progress).toBe("3 of 3 done");
    expect(m.requirements[1].text).toBe("Processing fee · Rs 5,000 paid");
    expect(m.main).toMatchObject({ kind: "applications", enabled: true, disabledReason: null });
  });
  it("lets the user try when the readiness check itself failed (the server re-checks)", () => {
    expect(buildStageCardModel(base({ readiness: null })).main.enabled).toBe(true);
  });
  it("basic-info gap is reported", () => {
    const m = buildStageCardModel(base({ readiness: { ready: false, missing: ["Basic info (Passport Number)"] } }));
    expect(m.requirements[0].ok).toBe(false);
  });
});

describe("stage card: Applications (last stage)", () => {
  it("has no next stage and no main button", () => {
    const m = buildStageCardModel(base({ currentListId: "applications" }));
    expect(m.next).toBeNull();
    expect(m.main).toMatchObject({ kind: "none", label: "In Applications", enabled: false });
  });
});

describe("stage card: footer by role", () => {
  it("chain first holder: Revert disabled with 'This lead started with you', no Move to…", () => {
    const m = buildStageCardModel(base({ revertTargetUserId: null }));
    expect(m.footer.revert).toMatchObject({ show: true, enabled: false, label: "Revert", tooltip: "This lead started with you" });
    expect(m.footer.moveTo).toBe(false);
  });
  it("chain with a prior holder: Revert to <previous> enabled", () => {
    expect(buildStageCardModel(base()).footer.revert).toMatchObject({ enabled: true, label: "Revert to Qualified" });
  });
  it("admin / branch manager: Revert always enabled even as origin, plus Move to…", () => {
    const m = buildStageCardModel(base({ canMoveWithoutChain: true, revertTargetUserId: null }));
    expect(m.footer.revert).toMatchObject({ enabled: true, label: "Revert to Qualified" });
    expect(m.footer.moveTo).toBe(true);
  });
  it("read-only viewer: nothing is enabled", () => {
    const m = buildStageCardModel(base({ canWork: false, canMoveWithoutChain: true }));
    expect(m.footer.revert.enabled).toBe(false);
    expect(m.footer.moveTo).toBe(false);
    expect(m.footer.archive).toBe(false);
    expect(m.main.enabled).toBe(false);
  });
  it("a destination outside the caller's accessible lists is disabled with the reason", () => {
    const m = buildStageCardModel(base({ currentListId: "qualified", accessibleLists: LISTS.slice(0, 2) }));
    expect(m.main).toMatchObject({ enabled: false, disabledReason: "No access to Prospects" });
  });
});

describe("stage card: archived", () => {
  it("shows no actions and no requirements", () => {
    const m = buildStageCardModel(base({ isArchived: true, currentListId: "archived" }));
    expect(m.footer.archive).toBe(false);
    expect(m.footer.revert.show).toBe(false);
    expect(m.requirements).toEqual([]);
    expect(m.main.enabled).toBe(false);
  });
});
