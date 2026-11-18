"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckSquareIcon, DotsThreeIcon, EnvelopeSimpleIcon, EyeIcon, NotePencilIcon, PhoneIcon, WhatsappLogoIcon,
} from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatPhoneForTel, formatPhoneForWhatsApp } from "@/lib/phone-utils";
import { getLeadFullName } from "@/components/dashboard/lead/lead-name";
import { consentProfileKey } from "@/lib/consent/readiness";
import { hasProspectQualification } from "@/lib/leads/prospect-qualification";
import { isOtherLead } from "@/lib/leads/lead-type";
import { leadWorkGates } from "./lib/work-gates";
import type { Lead, LeadList, PipelineStage } from "@/types/database";
import { initialsOf } from "../record-preview/parts";
import { usePreviewData } from "../record-preview/use-preview-data";
import { AllValues } from "./all-values";
import { DetailsList } from "./details";
import { StageCard } from "./stage-card";
import { FeePopover } from "./fee-popover";
import type { LeadFile } from "./lead-file";
import { BigAvatar, CopyIconButton, IconButton } from "./ui";
import { buildMoveMenu } from "./lib/move-model";
import { Dot } from "../record-preview/parts";
import { rememberOrigin } from "./focus-origin";
import { buildStageCardModel, stageColor, type ApplicationsReadiness, type RequirementAction } from "./lib/stage-card-model";
import type { PickerOption } from "./picker";
import type { Assignee, Person, useLeadActions } from "./use-lead-actions";

type Actions = ReturnType<typeof useLeadActions>;

export interface LeftColumnProps {
  lead: Lead;
  actions: Actions;
  stages: PipelineStage[];
  leadLists: LeadList[];
  activeLeadLists: LeadList[];
  userId: string;
  memberNames: Record<string, string>;
  isAdmin: boolean;
  leadScope: "all" | "own" | "team" | undefined;
  canEdit: boolean;
  isEditor: boolean;
  canAssign: boolean;
  canMoveWithoutChain: boolean;
  revertTargetUserId: string | null;
  consentEnabled: boolean;
  consentSigned: boolean;
  assignableMembers: Person[];
  stageScopedAssignees: Assignee[] | null;
  roster: Person[];
  /** The student file: the stage card's "Record" and "Copy link" call the SAME handlers as the rail (EDGEX-154). */
  file: LeadFile;
  /** May copy / send / sign consent (the Applications manage rule). */
  canManageConsent: boolean;
  onNote: () => void;
  onTask: () => void;
  onEditProfile: (missing?: string[]) => void;
  onDelete: () => void;
  /** "Merge duplicates…" in the ··· menu (admins). */
  onMerge: () => void;
  /** The frame's ⌘↵ shortcut runs the stage card's main button through this ref. */
  mainRef: React.MutableRefObject<{ enabled: boolean; run: () => void } | null>;
}

function addedLabel(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function LeftColumn(p: LeftColumnProps) {
  const lead = p.actions.currentLead;
  const [allValues, setAllValues] = useState(false);
  const { data } = usePreviewData(lead.id, null, "top");

  const name = getLeadFullName(lead, "Unnamed lead");
  const isOther = isOtherLead(lead.tags, "education_consultancy");
  const currentList = [...p.activeLeadLists, ...p.leadLists].find((l) => l.id === lead.list_id) ?? null;
  const isArchived = !!currentList?.is_archive;
  // canWork = stage moves / Archive (assignee rule); canStatus = Status only, which a collaborator may also change (#670).
  const { canWork, canStatus } = leadWorkGates({ isAdmin: p.isAdmin, leadScope: p.leadScope, canEdit: p.canEdit, isEditor: p.isEditor, userId: p.userId, assignedTo: lead.assigned_to });
  const canFields = p.canEdit || p.isEditor;
  const canPickCounsellor = p.isAdmin || p.leadScope === "team" || (p.canAssign && (!lead.assigned_to || p.userId === lead.assigned_to));

  // What the NEXT stage needs: the server's own readiness answer (same rule it enforces on the move).
  const next = useMemo(() => {
    const chain = [...p.activeLeadLists].sort((a, b) => a.sort_order - b.sort_order);
    const i = chain.findIndex((l) => l.id === lead.list_id);
    return i >= 0 ? chain[i + 1] ?? null : null;
  }, [lead.list_id, p.activeLeadLists]);
  const [readiness, setReadiness] = useState<ApplicationsReadiness | null>(null);
  const readinessKey = `${lead.id}|${lead.list_id}|${lead.pre_app_fee_status}|${lead.pre_app_fee_amount}|${p.consentSigned}|${consentProfileKey(lead)}`;
  // Admins / branch managers also need it for the "Move to…" menu (Applications shows "n missing").
  const wantsReadiness = next?.slug === "applications" || (p.canMoveWithoutChain && p.activeLeadLists.some((l) => l.slug === "applications"));
  useEffect(() => {
    if (!wantsReadiness) return;
    let cancelled = false;
    fetch(`/api/v1/leads/${lead.id}/applications-readiness`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { ready?: boolean; missing?: string[] } } | null) => {
        if (!cancelled) setReadiness(j?.data && typeof j.data.ready === "boolean" ? { ready: j.data.ready, missing: j.data.missing ?? [] } : null);
      })
      .catch(() => { if (!cancelled) setReadiness(null); });
    return () => { cancelled = true; };
    // readinessKey covers every input that changes the server's answer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readinessKey, wantsReadiness]);

  // Profile row: the consent-form fields (existing endpoint: missing + the total it derives from the same field groups).
  const [profile, setProfile] = useState<{ missing: string[]; total: number; filled: number } | null>(null);
  const profileKey = consentProfileKey(lead);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/leads/${lead.id}/profile-completeness`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { missing?: string[]; total?: number; filled?: number } } | null) => {
        const d = j?.data;
        if (cancelled) return;
        setProfile(d && Array.isArray(d.missing) && typeof d.total === "number" && typeof d.filled === "number" ? { missing: d.missing, total: d.total, filled: d.filled } : null);
      })
      .catch(() => { if (!cancelled) setProfile(null); });
    return () => { cancelled = true; };
  }, [lead.id, profileKey]);

  const model = useMemo(
    () => buildStageCardModel({
      isOtherContact: isOther, activeLists: p.activeLeadLists, accessibleLists: p.leadLists, currentListId: lead.list_id ?? null,
      isArchived, canMoveWithoutChain: p.canMoveWithoutChain, revertTargetUserId: p.revertTargetUserId, canWork,
      hasQualification: hasProspectQualification(lead as unknown as Record<string, unknown>), readiness,
      consentEnabled: p.consentEnabled, consentSigned: p.consentSigned, feeStatus: lead.pre_app_fee_status ?? null, feeAmount: lead.pre_app_fee_amount ?? null,
    }),
    [canWork, isArchived, isOther, lead, p.activeLeadLists, p.canMoveWithoutChain, p.consentEnabled, p.consentSigned, p.leadLists, p.revertTargetUserId, readiness],
  );

  const chain = useMemo(() => [...p.activeLeadLists].sort((a, b) => a.sort_order - b.sort_order), [p.activeLeadLists]);
  const prevList = useMemo(() => { const i = chain.findIndex((l) => l.id === lead.list_id); return i > 0 ? chain[i - 1] : null; }, [chain, lead.list_id]);
  const accessibleIds = useMemo(() => new Set(p.leadLists.map((l) => l.id)), [p.leadLists]);
  const moveOptions: PickerOption[] = buildMoveMenu({ chain, accessibleIds, currentListId: lead.list_id ?? null, readiness }).map((o) => {
    const l = chain.find((x) => x.id === o.value);
    return { ...o, icon: l ? <Dot color={stageColor(l)} /> : undefined };
  });

  const statuses = useMemo(() => {
    const scoped = p.stages.filter((s) => s.pipeline_id === lead.pipeline_id);
    return scoped.length > 0 ? scoped : p.stages;
  }, [lead.pipeline_id, p.stages]);

  const goMain = () => {
    if (!model.next) return;
    const target = chain.find((l) => l.id === model.next!.id);
    if (!target) return;
    if (model.main.kind === "qualify") return p.actions.openQualify();
    void p.actions.startMove(target, p.canMoveWithoutChain ? "move" : "next");
  };

  useEffect(() => {
    p.mainRef.current = { enabled: model.main.enabled && model.main.kind !== "none" && !model.hidden, run: goMain };
    const ref = p.mainRef;
    return () => { ref.current = null; };
  });

  // "Add" opens the %/GPA gate. "Copy link" runs the one
  // consent handler the rail uses. "Record" is a popover anchored to the link itself (see StageCard's renderAction).
  const onRequirement = (a: RequirementAction) => {
    if (a === "add-qualification") return p.actions.openGate();
    if (a === "copy-consent") {
      // A half-filled profile can't get a consent link: send them to fix it (the rail's row says "Complete").
      if (p.file.consent.actionsBlocked) return p.onEditProfile();
      return void p.file.consent.handleCreateAndCopyLink();
    }
  };

  const archived = isArchived ? (() => {
    const from = [...p.leadLists, ...p.activeLeadLists].find((l) => l.id === lead.archived_from_list_id);
    const by = lead.archived_by ? (lead.archived_by === p.userId ? "you" : p.memberNames[lead.archived_by] ?? "someone") : "someone";
    return {
      reason: lead.archive_reason,
      text: `Archived ${lead.archived_at ? addedLabel(lead.archived_at) : ""} by ${by}${from ? ` from ${from.name}` : ""}.`.replace("  ", " "),
      restoreLabel: `Restore to ${from?.name ?? "the pipeline"}`,
    };
  })() : null;

  const sourceName = data?.source_name ?? (lead.intake_source ? lead.intake_source.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null);
  const created = `Added ${addedLabel(lead.created_at)}${sourceName ? ` · ${sourceName}` : ""}`;

  const copyLink = async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/leads/${lead.id}`); toast.success("Link copied"); } catch { toast.error("Failed to copy"); } };
  const copyId = async () => { try { await navigator.clipboard.writeText(lead.display_id ?? lead.id); toast.success("Lead ID copied"); } catch { toast.error("Failed to copy"); } };

  if (allValues) {
    return <AllValues lead={lead} name={name} canEdit={canFields} onPatch={p.actions.patchLead} onBack={() => setAllValues(false)} />;
  }

  const noPhone = "No phone number";
  return (
    // Phone (≤430): the column dissolves (`contents`) so identity, stage card, tabs and then the Details can be ordered as one page.
    <div className="max-[430px]:contents">
      {/* Identity */}
      <div className="px-4 pb-3 pt-4 max-[430px]:order-1 max-[430px]:pt-3.5">
        <div className="flex items-center gap-2.5">
          <BigAvatar initials={initialsOf(name)} />
          <h1 className="m-0 min-w-0 truncate text-[18px] font-semibold leading-6 tracking-[-.01em]">{name}</h1>
        </div>
        <div className="mt-2.5 flex flex-col gap-0.5 text-[13px] text-[#2b2d2f]">
          <div className="flex h-6 items-center gap-2">
            {lead.display_id && <span className="rounded-[6px] bg-[#f6f7f9] px-1.5 text-[12px] font-medium leading-[18px] text-[#6b6f76]">{lead.display_id}</span>}
            <span className="truncate text-[12px] text-black/50">{created}</span>
          </div>
          {lead.phone && (
            <div className="flex h-6 items-center gap-2">
              <PhoneIcon className="size-[14px] shrink-0 text-[#9a9ea5]" aria-hidden />
              <span className="min-w-0 truncate tabular-nums">{lead.phone}</span>
              <CopyIconButton value={lead.phone} label="Copy phone" />
            </div>
          )}
          {lead.email && (
            <div className="flex h-6 items-center gap-2">
              <EnvelopeSimpleIcon className="size-[14px] shrink-0 text-[#9a9ea5]" aria-hidden />
              <span className="min-w-0 truncate">{lead.email}</span>
              <CopyIconButton value={lead.email} label="Copy email" />
            </div>
          )}
        </div>
        <div className="mt-3 flex gap-1.5">
          {lead.email ? (
            <a href={`mailto:${lead.email}`} className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-white px-2 text-[14px] font-medium text-[#101112] shadow-[inset_0_0_0_1px_#e8e9eb] outline-none hover:bg-[#f6f7f9] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 max-[430px]:w-7 max-[430px]:justify-center max-[430px]:px-0" aria-label="Email" title="Email (E)">
              <EnvelopeSimpleIcon className="size-[14px]" /><span className="max-[430px]:hidden">Email</span>
            </a>
          ) : (
            <button type="button" disabled title="No email address" aria-label="Email" className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-white px-2 text-[14px] font-medium opacity-40 shadow-[inset_0_0_0_1px_#e8e9eb] max-[430px]:w-7 max-[430px]:justify-center max-[430px]:px-0">
              <EnvelopeSimpleIcon className="size-[14px]" /><span className="max-[430px]:hidden">Email</span>
            </button>
          )}
          <IconButton bordered label={lead.phone ? "Call" : noPhone} href={lead.phone ? `tel:${formatPhoneForTel(lead.phone)}` : undefined} disabled={!lead.phone}><PhoneIcon /></IconButton>
          <IconButton bordered label={lead.phone ? "WhatsApp" : noPhone} disabled={!lead.phone} onClick={() => window.open(`https://wa.me/${formatPhoneForWhatsApp(lead.phone as string)}`, "_blank")}><WhatsappLogoIcon /></IconButton>
          <IconButton bordered label="Add note (N)" onClick={p.onNote}><NotePencilIcon /></IconButton>
          <IconButton bordered label="Add task (T)" onClick={p.onTask}><CheckSquareIcon /></IconButton>
          <MoreMenu isAdmin={p.isAdmin} onCopyLink={copyLink} onCopyId={copyId} onDelete={p.onDelete} onMerge={p.onMerge} bordered />
        </div>
      </div>

      <StageCard
        model={model} statuses={statuses} statusId={lead.stage_id} canChangeStatus={canStatus && !isOther}
        onStatus={(s) => void p.actions.patchLead(
          { stage_id: s.id, ...(s.pipeline_id && s.pipeline_id !== lead.pipeline_id ? { pipeline_id: s.pipeline_id } : {}) },
          "status", { status: s.slug },
        )}
        onMain={goMain} onRequirement={onRequirement}
        actionAllowed={(a) => (a === "record-fee" ? p.file.fee.canManageFee || p.file.fee.canReportFee : a === "copy-consent" ? p.canManageConsent : true)}
        wrapRecord={(trigger) => <FeePopover fee={p.file.fee}>{trigger}</FeePopover>}
        onRevert={() => prevList && void p.actions.startMove(prevList, "back")}
        moveOptions={moveOptions} currentListId={lead.list_id ?? null}
        onMovePick={(id) => {
          const l = chain.find((x) => x.id === id);
          if (!l) return;
          if (l.slug === "qualified" && currentList?.is_intake) return p.actions.openQualify();
          void p.actions.startMove(l, "move");
        }}
        onArchive={p.actions.openArchive}
        archived={archived} onRestore={() => void p.actions.restore()}
      />

      {/* Details: at phone width they follow the tab panel (order 4) so the tabs sit right under the stage card. */}
      <div className="max-[430px]:order-4 max-[430px]:pb-2">
      <div className="mt-2.5 flex h-9 items-center px-4">
        <h2 className="m-0 text-[14px] font-medium leading-5 text-[#101112]">Details</h2>
        <button type="button" onClick={() => p.onEditProfile()} className="ml-auto rounded-[4px] text-[13px] text-[#6b6f76] outline-none hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50">Edit profile</button>
      </div>
      <DetailsList
        lead={lead} currentUserId={p.userId} memberNames={p.memberNames} branchName={data?.branch_name ?? null} sourceName={sourceName} intake={data?.intake ?? null}
        canEdit={canFields} canPickCounsellor={canPickCounsellor} isAdmin={p.isAdmin} isBranchManager={p.leadScope === "team"}
        counsellorOptions={p.stageScopedAssignees ?? p.assignableMembers} roster={p.roster}
        onAssign={(id) => void p.actions.changeAssignment(id)} onPatch={p.actions.patchLead} hideStudy={isOther}
      />
      <button type="button" onClick={() => setAllValues(true)} className="mx-4 mt-1 flex items-center gap-1 rounded-[4px] text-[12px] font-medium leading-4 text-black/50 outline-none hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50">
        <EyeIcon className="size-3" aria-hidden />View all values
      </button>

      {/* Profile */}
      {profile && (
        <div className="mx-3 mb-4 mt-3 flex items-center gap-2.5 rounded-[12px] px-3 py-2.5 shadow-[inset_0_0_0_1px_#eeeff1] max-[430px]:mx-4">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-[18px]">Profile {profile.filled} of {profile.total} filled</div>
            <div className="text-[12px] font-medium leading-4 text-black/50">Needed for the consent form</div>
            <div aria-hidden className="relative mt-2 h-1 overflow-hidden rounded-[2px] bg-[#f0f1f2]">
              <i className="absolute inset-y-0 left-0 rounded-[2px] bg-[#101112]" style={{ width: `${profile.total > 0 ? Math.round((profile.filled / profile.total) * 100) : 0}%` }} />
            </div>
          </div>
          {profile.missing.length > 0 && (
            <button type="button" onClick={() => p.onEditProfile(profile.missing)} className="shrink-0 rounded-[4px] text-[13px] text-[#266df0] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#266df0]/50">Complete</button>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

export function MoreMenu({ isAdmin, onCopyLink, onCopyId, onDelete, onMerge, onEditProfile, bordered }: { isAdmin: boolean; onCopyLink: () => void; onCopyId: () => void; onDelete: () => void; onMerge: () => void; /** Phone header only: the "Edit profile" text button is hidden there, so it lives in ···. */ onEditProfile?: () => void; bordered?: boolean }) {
  // Dialogs opened from this menu hand focus back to ITS trigger button (the menu's items are gone by then).
  const triggerRef = useRef<HTMLButtonElement>(null);
  const viaMenu = (fn: () => void) => () => { rememberOrigin(triggerRef.current); fn(); };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger ref={triggerRef} aria-label="More actions" title="More actions" className={`inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] text-[#6b6f76] outline-none hover:bg-[#f6f7f9] hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 data-[state=open]:bg-[#f6f7f9] ${bordered ? "bg-white text-[#2b2d2f] shadow-[inset_0_0_0_1px_#e8e9eb]" : ""}`}>
        <DotsThreeIcon className="size-[14px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px] rounded-[12px]">
        {onEditProfile && <DropdownMenuItem className="rounded-[8px] min-[431px]:hidden" onSelect={onEditProfile}>Edit profile</DropdownMenuItem>}
        <DropdownMenuItem className="rounded-[8px]" onSelect={onCopyLink}>Copy link to this lead</DropdownMenuItem>
        <DropdownMenuItem className="rounded-[8px]" onSelect={onCopyId}>Copy lead ID</DropdownMenuItem>
        {isAdmin && <DropdownMenuItem className="rounded-[8px]" onSelect={viaMenu(onMerge)}>Merge duplicates…</DropdownMenuItem>}
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="rounded-[8px] text-[#c4321f] focus:text-[#c4321f]" onSelect={viaMenu(onDelete)}>Delete lead</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
