"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  BuildingIcon, GraduationCapIcon, GlobeIcon, LinkIcon, LockIcon, MapPinIcon, PauseCircleIcon, PlusIcon, TagIcon, UserIcon, UsersIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { getLeadCity } from "@/lib/leads/lead-location";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";
import type { Lead } from "@/types/database";
import { Avatar, initialsOf } from "../record-preview/parts";
import { formatIntake, pickTestScore } from "../record-preview/lib/study-plan";
import { Picker, type PickerOption } from "./picker";
import type { Person } from "./use-lead-actions";
import { Pill } from "./ui";
import { canRemoveCollaborator, collaboratorControls, visibleCollaborators, type Collaborator } from "./lib/details-model";


const personName = (m: Person) => m.name || m.email.split("@")[0];

interface DetailsProps {
  lead: Lead;
  currentUserId: string;
  memberNames: Record<string, string>;
  branchName: string | null;
  sourceName: string | null;
  intake: string | null;
  /** May edit the lead's working data in place (admin / canEditLeads / assignee / collaborator). */
  canEdit: boolean;
  /** May change the counsellor (today's rule); false shows the lock. */
  canPickCounsellor: boolean;
  isAdmin: boolean;
  /** Branch manager (team scope): may add / remove collaborators on leads in their branch. */
  isBranchManager?: boolean;
  counsellorOptions: Person[];
  /** Roster for the collaborator picker (admins only; others never open it). */
  roster: Person[];
  onAssign: (userId: string | null) => void;
  onPatch: (fields: Record<string, unknown>, label?: string) => Promise<boolean>;
  /** Hides the study rows for Other-tagged contacts. */
  hideStudy: boolean;
}

const ROW = "group/row flex min-h-8 items-center gap-2 rounded-[8px] px-1.5";
const KEY = "flex w-[106px] shrink-0 items-center gap-2 whitespace-nowrap text-[12px] font-medium leading-4 text-black/[.63] [&_svg]:size-[14px] [&_svg]:text-[#9a9ea5]";
const VAL = "flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[14px] font-medium leading-5";

export function DetailRow({
  icon, label, children, editable, onActivate, lock, wrap, active, empty,
}: {
  icon: ReactNode; label: string; children: ReactNode; editable?: boolean; onActivate?: () => void; lock?: string; wrap?: boolean; active?: boolean; empty?: boolean;
}) {
  return (
    <div className={cn(ROW, editable && "hover:bg-[#f6f7f9]", active && "bg-[#f6f7f9]")}>
      <span className={KEY}>{icon}{label}</span>
      {editable && onActivate ? (
        <button
          type="button" onClick={onActivate} aria-label={`Edit ${label}`}
          className={cn(VAL, "rounded-[6px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[#266df0]/50", wrap && "flex-wrap whitespace-normal py-[5px]", empty && "text-black/50")}
        >
          {children}
        </button>
      ) : (
        <div className={cn(VAL, wrap && "flex-wrap whitespace-normal py-[5px] [row-gap:4px]", empty && "text-black/50")}>{children}</div>
      )}
      {lock && <span title={lock} aria-label={lock} className="ml-auto text-[#d0d3d7]"><LockIcon className="size-3" /></span>}
    </div>
  );
}

/** Inline text field: 28px, radius 8, 1px blue ring. Enter saves, Esc cancels, leaving the field saves a changed value. */
export function InlineText({ value, placeholder, onSave, onDone, type = "text" }: { value: string; placeholder: string; onSave: (v: string) => Promise<boolean> | boolean; onDone: () => void; type?: string }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = async () => {
    if (finished.current) return;
    finished.current = true;
    if (v.trim() !== value.trim()) await onSave(v.trim());
    onDone();
  };
  return (
    <input
      ref={ref} type={type} value={v} placeholder={placeholder} aria-label={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); void commit(); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finished.current = true; onDone(); }
      }}
      className="mx-0 my-0.5 h-7 min-w-0 flex-1 rounded-[8px] bg-white px-2 text-[14px] font-medium leading-5 text-[#101112] shadow-[0_0_0_1px_#266df0] outline-none"
    />
  );
}

/** Collaborators for one lead: read for everyone (the server returns them), add / remove for owner/admin and branch managers; anyone may remove themselves. */
function useCollaborators(leadId: string, canManage: boolean, currentUserId: string) {
  const [list, setList] = useState<Collaborator[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/leads/${leadId}/collaborators`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setList((j.data?.collaborators ?? []) as Collaborator[]); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [leadId]);

  const add = useCallback(async (p: Person) => {
    if (!canManage) return;
    const prev = list;
    setList((l) => [...l, { user_id: p.user_id, email: p.email, name: personName(p) }]);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/collaborators`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: p.user_id }) });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message || "Failed to add collaborator");
      if (json?.data?.collaborator) setList((l) => l.map((c) => (c.user_id === p.user_id ? (json.data.collaborator as Collaborator) : c)));
    } catch (err) {
      setList(prev);
      toast.error(err instanceof Error ? err.message : "Failed to add collaborator");
    }
  }, [canManage, leadId, list]);

  const remove = useCallback(async (c: Collaborator) => {
    if (!canRemoveCollaborator(c.user_id, currentUserId, canManage)) return;
    const prev = list;
    setList((l) => l.filter((x) => x.user_id !== c.user_id));
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/collaborators/${c.user_id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || "Failed to remove collaborator");
      toast.success(`${c.name} removed`, {
        action: { label: "Undo", onClick: () => { void fetch(`/api/v1/leads/${leadId}/collaborators`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: c.user_id }) }).then((r) => { if (r.ok) setList((l) => [...l, c]); }); } },
      });
    } catch (err) {
      setList(prev);
      toast.error(err instanceof Error ? err.message : "Failed to remove collaborator");
    }
  }, [canManage, currentUserId, leadId, list]);

  return { list, add, remove };
}

export function DetailsList(p: DetailsProps) {
  const { lead } = p;
  const { destinations: destOptions, fieldsOfStudy, studyLevels } = useEduTaxonomy();
  const [editing, setEditing] = useState<string | null>(null);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const cc = collaboratorControls(p.isAdmin, p.isBranchManager);
  const collab = useCollaborators(lead.id, cc.canAdd, p.currentUserId);

  const assigned = lead.assigned_to;
  const counsellorName = assigned ? (assigned === p.currentUserId ? "You" : p.memberNames[assigned] ?? "Unknown") : null;
  const shownCollaborators = useMemo(() => visibleCollaborators(collab.list, assigned), [collab.list, assigned]);

  const openTags = useCallback(() => {
    setEditing("tags");
    fetch("/api/v1/leads/tags").then((r) => (r.ok ? r.json() : null)).then((b: { data?: { tags: Array<{ tag: string }> } } | null) => setTagOptions((b?.data?.tags ?? []).map((t) => t.tag))).catch(() => {});
  }, []);

  const counsellorPeople = useMemo(() => {
    const base = p.counsellorOptions;
    return assigned && !base.some((m) => m.user_id === assigned) && p.memberNames[assigned] ? [...base, { user_id: assigned, email: "", name: p.memberNames[assigned] }] : base;
  }, [assigned, p.counsellorOptions, p.memberNames]);
  const counsellorOpts: PickerOption[] = counsellorPeople.map((m) => ({ value: m.user_id, label: personName(m), icon: <Avatar initials={initialsOf(personName(m))} size={18} /> }));

  const collabOptions: PickerOption[] = useMemo(() => {
    const taken = new Set([...collab.list.map((c) => c.user_id), ...(assigned ? [assigned] : [])]);
    return p.roster.filter((m) => !taken.has(m.user_id)).map((m) => ({ value: m.user_id, label: personName(m), group: m.position_name || (m.role ? m.role[0].toUpperCase() + m.role.slice(1) : "Team"), icon: <Avatar initials={initialsOf(personName(m))} size={18} /> }));
  }, [assigned, collab.list, p.roster]);

  const tags = lead.tags ?? [];
  const setTags = (next: string[]) => p.onPatch({ tags: next }, "tags");

  const city = getLeadCity(lead) ?? "";
  const dests = lead.destinations ?? [];
  const intake = p.intake ?? (lead as Lead & { intake_term?: string | null }).intake_term ?? null;
  const test = pickTestScore({ ielts: lead.ielts_score, pte: lead.pte_score, toefl: lead.toefl_score });
  const course = [lead.degree_level, lead.field_of_study, test].filter(Boolean).join(" · ");

  const ce = p.canEdit;
  const studyEditable = ce && !p.hideStudy;

  const levelFieldOptions: PickerOption[] = [
    ...studyLevels.map((l) => ({ value: `level:${l}`, label: l, group: "Level" })),
    ...fieldsOfStudy.map((f) => ({ value: `field:${f}`, label: f, group: "Course" })),
  ];

  return (
    <div className="px-2.5" role="list" aria-label="Details">
      <div role="listitem">
        <Picker
          open={editing === "counsellor"} onOpenChange={(o) => setEditing(o ? "counsellor" : null)} options={counsellorOpts} selected={assigned ? [assigned] : []} placeholder="Assign to…"
          onPick={(id) => { if (id !== assigned) p.onAssign(id); }}
          footer={() => (assigned ? { label: "Unassign", onSelect: () => p.onAssign(null) } : null)}
        >
          <div>
            <DetailRow
              icon={<UserIcon />} label="Assignee" editable={p.canPickCounsellor} onActivate={() => setEditing("counsellor")} active={editing === "counsellor"}
              lock={p.canPickCounsellor ? undefined : "Only managers can reassign"} empty={!counsellorName}
            >
              {counsellorName ? <><Avatar initials={initialsOf(assigned ? p.memberNames[assigned] ?? counsellorName : "")} /><span className="truncate">{counsellorName}</span></> : "Unassigned"}
            </DetailRow>
          </div>
        </Picker>
      </div>

      <div role="listitem">
        <Picker
          open={editing === "collaborators"} onOpenChange={(o) => setEditing(o ? "collaborators" : null)} options={collabOptions} selected={[]} keepOpen placeholder="Add a collaborator…"
          onPick={(id) => { const m = p.roster.find((x) => x.user_id === id); if (m) void collab.add(m); }}
          emptyText="Everyone is already on this lead"
        >
          <div>
            <DetailRow
              icon={<UsersIcon />} label="Collaborators" wrap empty={shownCollaborators.length === 0}
              lock={cc.lockTooltip ?? undefined}
            >
              {shownCollaborators.length === 0 ? <span className="text-black/50">None</span> : shownCollaborators.map((c) => (
                <Pill key={c.user_id} avatar={<Avatar initials={initialsOf(c.name)} size={18} />} onRemove={canRemoveCollaborator(c.user_id, p.currentUserId, cc.canRemove) ? () => void collab.remove(c) : undefined} removeLabel={`Remove ${c.name}`}>{c.name}</Pill>
              ))}
              {cc.canAdd && (
                <button type="button" aria-label="Add collaborator" title="Add collaborator" onClick={() => setEditing("collaborators")} className="inline-flex size-6 items-center justify-center rounded-[6px] text-[#9a9ea5] opacity-0 outline-none hover:bg-[#eef0f3] hover:text-[#101112] focus-visible:opacity-100 group-hover/row:opacity-100">
                  <PlusIcon className="size-3" />
                </button>
              )}
            </DetailRow>
          </div>
        </Picker>
      </div>

      <div role="listitem"><DetailRow icon={<BuildingIcon />} label="Branch" empty={!p.branchName}>{p.branchName ?? "No branch"}</DetailRow></div>
      <div role="listitem"><DetailRow icon={<LinkIcon />} label="Source" empty={!p.sourceName}>{p.sourceName ?? "No source"}</DetailRow></div>

      <div role="listitem">
        {editing === "city" ? (
          <DetailRow icon={<MapPinIcon />} label="City" active>
            <InlineText value={city} placeholder="City" onSave={(v) => p.onPatch({ city: v || null }, "city")} onDone={() => setEditing(null)} />
          </DetailRow>
        ) : (
          <DetailRow icon={<MapPinIcon />} label="City" editable={ce} onActivate={() => setEditing("city")} empty={!city}>{city || "Set city"}</DetailRow>
        )}
      </div>

      {!p.hideStudy && (
        <>
          <div role="listitem">
            <Picker
              open={editing === "study-in"} onOpenChange={(o) => setEditing(o ? "study-in" : null)} options={destOptions.map((d) => ({ value: d, label: d }))} selected={dests} keepOpen placeholder="Search countries…"
              onPick={(d) => void p.onPatch({ destinations: dests.includes(d) ? dests.filter((x) => x !== d) : [...dests, d] }, "study countries")}
            >
              <div>
                <DetailRow icon={<GlobeIcon />} label="Study in" editable={studyEditable} onActivate={() => setEditing("study-in")} active={editing === "study-in"} empty={dests.length === 0 && !intake}>
                  <span className="truncate">{dests.length || intake ? [dests.join(", ") || "Set study countries", intake ? formatIntake(intake) : null].filter(Boolean).join(" · ") : "Set study countries"}</span>
                </DetailRow>
              </div>
            </Picker>
          </div>
          <div role="listitem">
            <Picker
              open={editing === "course"} onOpenChange={(o) => setEditing(o ? "course" : null)} options={levelFieldOptions}
              selected={[lead.degree_level ? `level:${lead.degree_level}` : "", lead.field_of_study ? `field:${lead.field_of_study}` : ""].filter(Boolean)} keepOpen placeholder="Search level or course…" width={280}
              onPick={(v) => {
                const [kind, ...rest] = v.split(":");
                const value = rest.join(":");
                if (kind === "level") void p.onPatch({ degree_level: lead.degree_level === value ? null : value }, "level");
                else void p.onPatch({ field_of_study: lead.field_of_study === value ? null : value }, "course");
              }}
            >
              <div>
                <DetailRow icon={<GraduationCapIcon />} label="Course" editable={studyEditable} onActivate={() => setEditing("course")} active={editing === "course"} empty={!course}>
                  <span className="truncate">{course || "Set course and level"}</span>
                </DetailRow>
              </div>
            </Picker>
          </div>
        </>
      )}

      <div role="listitem">
        <Picker
          open={editing === "tags"} onOpenChange={(o) => (o ? openTags() : setEditing(null))} options={tagOptions.filter((t) => !tags.includes(t)).map((t) => ({ value: t, label: t }))} selected={[]} placeholder="Search or create a tag…"
          onPick={(t) => void setTags([...tags, t])}
          footer={(q) => (q && !tags.includes(q) && !tagOptions.some((t) => t.toLowerCase() === q.toLowerCase()) ? { label: `Create "${q}"`, onSelect: () => void setTags([...tags, q]) } : null)}
        >
          <div>
            <DetailRow icon={<TagIcon />} label="Tags" wrap empty={tags.length === 0} editable={ce && tags.length === 0} onActivate={openTags}>
              {tags.length === 0 ? "Add tag" : tags.map((t) => <Pill key={t} onRemove={ce ? () => void setTags(tags.filter((x) => x !== t)) : undefined} removeLabel={`Remove tag ${t}`}>{t}</Pill>)}
              {ce && tags.length > 0 && (
                <button type="button" aria-label="Add tag" title="Add tag" onClick={openTags} className="inline-flex size-6 items-center justify-center rounded-[6px] text-[#9a9ea5] opacity-0 outline-none hover:bg-[#eef0f3] hover:text-[#101112] focus-visible:opacity-100 group-hover/row:opacity-100"><PlusIcon className="size-3" /></button>
              )}
            </DetailRow>
          </div>
        </Picker>
      </div>

      <div role="listitem">
        <DetailRow icon={<PauseCircleIcon />} label="On hold">
          <button
            type="button" role="switch" aria-checked={!!lead.on_hold} aria-label="On hold" disabled={!ce}
            onClick={() => void p.onPatch({ on_hold: !lead.on_hold }, "on hold")}
            className={cn("relative h-4 w-7 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#266df0]/50 disabled:cursor-not-allowed", lead.on_hold ? "bg-[#101112]" : "bg-[#d0d3d7]")}
          >
            <span className={cn("absolute top-0.5 size-3 rounded-full bg-white transition-[left]", lead.on_hold ? "left-[14px]" : "left-0.5")} />
          </button>
        </DetailRow>
      </div>
    </div>
  );
}
