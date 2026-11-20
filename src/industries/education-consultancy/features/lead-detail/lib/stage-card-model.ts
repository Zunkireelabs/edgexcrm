import type { LeadList } from "@/types/database";

/**
 * Pure model behind the Stage card (EDGEX-152): which segments show, what the NEXT stage still needs, what the main
 * button says and whether it is enabled, and what the footer offers for this role. The card only renders this.
 */

/** Stage colours from the approved mockup (Admizz's four stages); any other list falls back to its own colour. */
export const STAGE_COLORS: Record<string, string> = {
  "pre-qualified": "#6366f1",
  qualified: "#3b82f6",
  prospects: "#f97316",
  applications: "#22c55e",
};
const FALLBACK_COLOR = "#9a9ea5";

export function stageColor(list: Pick<LeadList, "slug" | "color">): string {
  return STAGE_COLORS[list.slug] ?? list.color ?? FALLBACK_COLOR;
}

export type RequirementAction = "add-qualification" | "record-fee" | "copy-consent";

export interface Requirement {
  id: "qualification" | "basic-info" | "fee" | "consent";
  text: string;
  ok: boolean;
  /** Link label (Add / Record / Copy link) — only on a requirement that is still open. */
  actionLabel?: string;
  action?: RequirementAction;
}

export type MainKind = "qualify" | "send" | "move" | "applications" | "none";

export interface StageCardModel {
  /** Other-tagged contacts never enter the pipeline: no card at all. */
  hidden: boolean;
  segments: Array<{ id: string; name: string; color: string; state: "done" | "current" | "later" }>;
  current: { id: string; name: string; color: string } | null;
  next: { id: string; name: string; slug: string } | null;
  nextTitle: string;
  /** "1 of 3 done" — only when the next stage has requirements. */
  progress: string | null;
  hint: string | null;
  requirements: Requirement[];
  main: { kind: MainKind; label: string; enabled: boolean; disabledReason: string | null };
  footer: {
    revert: { show: boolean; label: string; enabled: boolean; tooltip: string | null };
    moveTo: boolean;
    archive: boolean;
  };
}

export interface ApplicationsReadiness {
  ready: boolean;
  missing: string[];
}

export interface StageCardInput {
  isOtherContact: boolean;
  /** The full active funnel (no archive / staging), any order. */
  activeLists: LeadList[];
  /** Lists the caller may move into (the server enforces the same). */
  accessibleLists: LeadList[];
  currentListId: string | null;
  isArchived: boolean;
  /** Admin / owner / branch manager: Move to… + Revert always allowed, "Move to" wording. */
  canMoveWithoutChain: boolean;
  /** Who revert would hand the lead back to; null = the caller is the first holder. */
  revertTargetUserId: string | null;
  /** The viewer may change the lead's stage at all (edit scope). */
  canWork: boolean;
  hasQualification: boolean;
  /** null = still loading / failed (failed lets the move through; the server re-checks). */
  readiness: ApplicationsReadiness | null;
  consentEnabled: boolean;
  consentSigned: boolean;
  /** Fee fields as the lead stores them (claimed counts for the gate). */
  feeStatus: string | null;
  feeAmount: number | null;
}

const hasBasicInfoGap = (missing: string[]) => missing.some((m) => /^Basic info/i.test(m.trim()));
const hasFeeGap = (missing: string[]) => missing.some((m) => m.trim() === "Processing fee");
const hasConsentGap = (missing: string[]) => missing.some((m) => m.trim() === "Consent signed");

function feeText(status: string | null, amount: number | null): string {
  const amt = amount != null ? ` · Rs ${amount.toLocaleString("en-US")}` : "";
  if (status === "paid") return `Processing fee${amt} paid`;
  if (status === "waiver") return "Processing fee waived";
  if (status === "claimed") return `Processing fee${amt} reported`;
  return "Processing fee";
}

export function buildStageCardModel(i: StageCardInput): StageCardModel {
  const chain = [...i.activeLists].sort((a, b) => a.sort_order - b.sort_order);
  const idx = chain.findIndex((l) => l.id === i.currentListId);
  const currentList = (idx >= 0 ? chain[idx] : null) ?? i.accessibleLists.find((l) => l.id === i.currentListId) ?? null;
  const prev = idx > 0 ? chain[idx - 1] : null;
  const next = idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : null;
  const accessible = new Set(i.accessibleLists.map((l) => l.id));

  const segments = chain.map((l, n) => ({
    id: l.id,
    name: l.name,
    color: stageColor(l),
    state: (idx < 0 ? "later" : n < idx ? "done" : n === idx ? "current" : "later") as "done" | "current" | "later",
  }));

  const base: StageCardModel = {
    hidden: i.isOtherContact,
    segments,
    current: currentList ? { id: currentList.id, name: currentList.name, color: stageColor(currentList) } : null,
    next: next ? { id: next.id, name: next.name, slug: next.slug } : null,
    nextTitle: next ? next.name : "",
    progress: null,
    hint: null,
    requirements: [],
    main: { kind: "none", label: "", enabled: false, disabledReason: null },
    footer: {
      revert: { show: false, label: "Revert", enabled: false, tooltip: null },
      moveTo: false,
      archive: false,
    },
  };
  if (i.isOtherContact) return base;

  // Footer — Revert, Move to… (admin / branch manager), Archive.
  if (prev && !i.isArchived) {
    const originGated = !i.canMoveWithoutChain && !i.revertTargetUserId;
    const reachable = accessible.has(prev.id);
    base.footer.revert = {
      show: true,
      label: originGated ? "Revert" : `Revert to ${prev.name}`,
      enabled: i.canWork && reachable && !originGated,
      tooltip: originGated ? "This lead started with you" : !reachable ? `No access to ${prev.name}` : null,
    };
  }
  base.footer.moveTo = i.canMoveWithoutChain && i.canWork && !i.isArchived;
  base.footer.archive = i.canWork && !i.isArchived;

  if (i.isArchived || !currentList) return base;

  if (!next) {
    base.main = { kind: "none", label: `In ${currentList.name}`, enabled: false, disabledReason: null };
    return base;
  }

  const reachable = accessible.has(next.id);
  const noAccess = !reachable ? `No access to ${next.name}` : !i.canWork ? "You can't move this lead" : null;

  // Pre-qualified → Qualified: the Qualify pop-up (same for every role).
  if (currentList.is_intake && next.slug === "qualified") {
    base.hint = "Qualify asks for the study countries, course and level. At least a country or a course is needed.";
    base.main = { kind: "qualify", label: "Qualify", enabled: !noAccess, disabledReason: noAccess };
    return base;
  }

  // Qualified → Prospects: the +2 / Bachelor / Masters %/GPA.
  if (next.slug === "prospects") {
    base.requirements = [
      {
        id: "qualification",
        text: "+2, Bachelor or Masters %/GPA",
        ok: i.hasQualification,
        ...(i.hasQualification ? {} : { actionLabel: "Add", action: "add-qualification" as const }),
      },
    ];
    base.progress = `${i.hasQualification ? 1 : 0} of 1 done`;
    base.main = {
      kind: "send",
      label: i.canMoveWithoutChain ? `Move to ${next.name}` : `Send to ${next.name}`,
      enabled: !noAccess,
      disabledReason: noAccess,
    };
    return base;
  }

  // Prospects → Applications: the same rule the server enforces (GET applications-readiness).
  if (next.slug === "applications") {
    const missing = i.readiness?.missing ?? [];
    const basicOk = i.readiness ? !hasBasicInfoGap(missing) : false;
    const feeOk = i.readiness ? !hasFeeGap(missing) : i.feeStatus === "paid" || i.feeStatus === "waiver" || i.feeStatus === "claimed";
    const reqs: Requirement[] = [
      { id: "basic-info", text: "Basic info for the consent form", ok: basicOk },
      {
        id: "fee",
        text: feeText(i.feeStatus, i.feeAmount),
        ok: feeOk,
        ...(feeOk ? {} : { actionLabel: "Record", action: "record-fee" as const }),
      },
    ];
    if (i.consentEnabled) {
      const consentOk = i.readiness ? !hasConsentGap(missing) : i.consentSigned;
      reqs.push({
        id: "consent",
        text: consentOk ? "Consent signed" : "Consent signed",
        ok: consentOk,
        ...(consentOk ? {} : { actionLabel: "Copy link", action: "copy-consent" as const }),
      });
    }
    base.requirements = reqs;
    const done = reqs.filter((r) => r.ok).length;
    base.progress = `${done} of ${reqs.length} done`;
    // Failed/unknown readiness lets the user try (the server re-checks); known gaps disable with the reasons.
    const ready = i.readiness ? i.readiness.ready : true;
    const reason = noAccess ?? (!ready ? `Missing: ${missing.join(" · ")}` : null);
    base.main = { kind: "applications", label: `Move to ${next.name}`, enabled: !reason, disabledReason: reason };
    return base;
  }

  base.main = { kind: "move", label: i.canMoveWithoutChain ? `Move to ${next.name}` : `Send to ${next.name}`, enabled: !noAccess, disabledReason: noAccess };
  return base;
}
