"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { BriefcaseIcon, FileTextIcon, GraduationCapIcon, PlusIcon, ShieldCheckIcon, UserCheckIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types/database";
import { shortDate } from "../record-preview/lib/readiness";
import { CountChip } from "../record-preview/parts";
import { ConsentBox } from "./consent-box";
import type { LeadFile } from "./lead-file";
import type { TabId } from "./lib/tabs";

const ROW = "flex h-8 items-center gap-2 rounded-[8px] px-2 text-[13px]";
const BOX = "rounded-[12px] p-1 shadow-[inset_0_0_0_1px_#eeeff1]";
const SHOWN = 3;

function Section({
  tab, icon, title, count, add, onOpen, children,
}: {
  tab: TabId; icon: ReactNode; title: string; count?: number | null;
  add?: { label: string; onClick: () => void; ariaDisabled?: boolean; title?: string };
  onOpen: (t: TabId) => void; children: ReactNode;
}) {
  return (
    <section className="mt-2" data-testid={`rail-${tab}`} aria-label={title}>
      <div className="flex h-9 items-center gap-1.5 px-1">
        <button type="button" title={`Open the ${title} tab`} onClick={() => onOpen(tab)} className="flex items-center gap-1.5 rounded-[6px] text-[14px] font-medium leading-5 text-black/[.63] outline-none hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 [&_svg]:size-4">
          {icon}{title}
          {count !== undefined && count !== null && <CountChip>{count}</CountChip>}
        </button>
        {add && (
          <button
            type="button" onClick={add.onClick} aria-label={add.label} title={add.title ?? add.label} aria-disabled={add.ariaDisabled || undefined}
            className={cn("ml-auto inline-flex size-6 items-center justify-center rounded-[8px] text-[#6b6f76] outline-none hover:bg-[#f6f7f9] hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 [&_svg]:size-[14px]", add.ariaDisabled && "opacity-50")}
          >
            <PlusIcon />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** Empty section: one 32px row with a ring, text .5 and a blue call to action. */
function EmptyRow({ text, cta, onCta }: { text: string; cta?: string; onCta?: () => void }) {
  return (
    <div className={cn(ROW, "text-black/50 shadow-[inset_0_0_0_1px_#eeeff1]")}>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {cta && onCta && <button type="button" onClick={onCta} className="flex-none rounded-[4px] text-[13px] text-[#266df0] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#266df0]/50">{cta}</button>}
    </div>
  );
}

function ViewAll({ n, onClick }: { n: number; onClick: () => void }) {
  if (n <= SHOWN) return null;
  return <button type="button" onClick={onClick} className="mt-0.5 block w-full rounded-[8px] px-2 py-1 text-left text-[13px] text-[#266df0] outline-none hover:underline">View all {n}</button>;
}

function ext(name: string, mime: string): { label: string; img: boolean } {
  if (mime.startsWith("image/")) return { label: /\.png$/i.test(name) ? "PNG" : /\.webp$/i.test(name) ? "WEBP" : "JPG", img: true };
  if (/\.docx?$/i.test(name) || mime.includes("word")) return { label: "DOC", img: false };
  return { label: "PDF", img: false };
}

export interface RightRailProps {
  lead: Lead;
  file: LeadFile;
  /** unlock rules (computed by the page shell, same as the tabs) */
  applicationsActive: boolean;
  consentActive: boolean;
  classesActive: boolean;
  documentsActive: boolean;
  checkInActive: boolean;
  consentSigned: boolean;
  isAdmin: boolean;
  canManageConsent: boolean;
  canManageApplications: boolean;
  canEnroll: boolean;
  canUpload: boolean;
  teamMemberNames: Record<string, string>;
  openTab: (t: TabId) => void;
  onEditProfile: () => void;
  onCheckIn: () => void;
}

/**
 * The right rail (EDGEX-154): Consent & fee, Applications, Classes, Documents, Check-ins. Each section reads the SAME
 * store as its tab (`LeadFile`), so an edit in one shows in the other. The title opens the tab; "+" opens the same dialog
 * as the tab's main button.
 */
export function RightRail(p: RightRailProps) {
  const { file, lead } = p;
  const { applications, enrollments, documents, checkIns } = file;
  const locked = p.consentActive && !p.consentSigned;

  return (
    <div data-testid="right-rail" className="pt-1">
      {p.consentActive && (
        <section className="mt-2" aria-label="Consent & fee" data-testid="rail-consent">
          <div className="flex h-9 items-center gap-1.5 px-1">
            <button type="button" title="Open the Consent & fee tab" onClick={() => p.openTab("consent")} className="flex items-center gap-1.5 rounded-[6px] text-[14px] font-medium leading-5 text-black/[.63] outline-none hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 [&_svg]:size-4">
              <ShieldCheckIcon />Consent &amp; fee
            </button>
          </div>
          <ConsentBox file={file} canManage={p.canManageConsent} isAdmin={p.isAdmin} onEditProfile={p.onEditProfile} />
        </section>
      )}

      {p.applicationsActive && (
        <Section
          tab="applications" icon={<BriefcaseIcon />} title="Applications" count={applications.loading ? null : applications.applications.length} onOpen={p.openTab}
          add={p.canManageApplications ? {
            label: locked ? "Add application (unlocks after consent)" : "Add application", title: locked ? "Unlocks after consent" : "Add application",
            ariaDisabled: locked, onClick: () => void applications.requestAdd(),
          } : undefined}
        >
          {applications.applications.length > 0 ? (
            <div className={BOX}>
              {applications.applications.slice(0, SHOWN).map((a) => {
                const stage = (a as { application_stages?: { name?: string } | null }).application_stages;
                return (
                  <Link key={a.id} href={`/applications/${a.id}?from=lead&leadId=${lead.id}`} prefetch={false} className={cn(ROW, "outline-none hover:bg-[#f6f7f9] focus-visible:ring-2 focus-visible:ring-[#266df0]/50")}>
                    <span className="min-w-0 flex-1 truncate">{a.university_name}{a.program_name ? ` · ${a.program_name}` : ""}</span>
                    {stage?.name && <span className="flex-none text-[12px] font-medium text-black/50">{stage.name}</span>}
                  </Link>
                );
              })}
              <ViewAll n={applications.applications.length} onClick={() => p.openTab("applications")} />
            </div>
          ) : applications.loading ? (
            <EmptyRow text="Loading…" />
          ) : locked ? (
            <EmptyRow text="Unlocks after consent" />
          ) : (
            <EmptyRow text="No applications yet" cta={p.canManageApplications ? "Add" : undefined} onCta={() => void applications.requestAdd()} />
          )}
        </Section>
      )}

      {p.classesActive && (
        <Section
          tab="classes" icon={<GraduationCapIcon />} title="Classes" count={enrollments.loading ? null : enrollments.enrollments.length} onOpen={p.openTab}
          add={p.canEnroll ? { label: "Add to class", onClick: enrollments.openAdd } : undefined}
        >
          {enrollments.enrollments.length > 0 ? (
            <div className={BOX}>
              {enrollments.enrollments.slice(0, SHOWN).map((e) => (
                <div key={e.id} className={ROW}>
                  <span aria-hidden className={cn("size-1.5 flex-none rounded-full", e.status === "active" ? "bg-[#12805c]" : e.status === "completed" ? "bg-[#266df0]" : "bg-[#9a9ea5]")} />
                  <span className="min-w-0 flex-1 truncate">{e.classes?.name ?? "Unknown class"}</span>
                  <span className="flex-none text-[12px] font-medium capitalize text-black/50">{e.enrollment_type === "demo" ? "Demo · " : ""}{e.status}</span>
                </div>
              ))}
              <ViewAll n={enrollments.enrollments.length} onClick={() => p.openTab("classes")} />
            </div>
          ) : enrollments.loadError ? (
            <EmptyRow text="Couldn’t load classes" />
          ) : enrollments.loading ? (
            <EmptyRow text="Loading…" />
          ) : (
            <EmptyRow text="Not enrolled yet" cta={p.canEnroll ? "Add" : undefined} onCta={enrollments.openAdd} />
          )}
        </Section>
      )}

      {p.documentsActive && (
        <Section
          tab="documents" icon={<FileTextIcon />} title="Documents" count={documents.loading ? null : documents.docs.length} onOpen={p.openTab}
          add={p.canUpload ? { label: "Upload documents", onClick: documents.openUpload } : undefined}
        >
          {documents.docs.length > 0 ? (
            <div className={BOX}>
              {documents.docs.slice(0, SHOWN).map((d) => {
                const e = ext(d.original_filename || d.name, d.mime_type);
                return (
                  <div key={d.id} className={ROW}>
                    <span className={cn("w-[26px] flex-none rounded-[4px] text-center text-[9px] font-semibold leading-4", e.img ? "bg-[#e9f2ff] text-[#1d5bd0]" : "bg-[#fdecea] text-[#b4231a]")}>{e.label}</span>
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    <span className="flex-none text-[12px] font-medium text-black/50">{shortDate(d.created_at, "md")}</span>
                  </div>
                );
              })}
              <ViewAll n={documents.docs.length} onClick={() => p.openTab("documents")} />
            </div>
          ) : documents.loading ? (
            <EmptyRow text="Loading…" />
          ) : (
            <EmptyRow text="No documents yet" cta={p.canUpload ? "Upload" : undefined} onCta={documents.openUpload} />
          )}
        </Section>
      )}

      {p.checkInActive && (
        <Section
          tab="checkins" icon={<UserCheckIcon />} title="Check-ins" count={checkIns.loading ? null : checkIns.records.length} onOpen={p.openTab}
          add={{ label: "Record check-in", onClick: checkIns.openCheckIn }}
        >
          {checkIns.records.length > 0 ? (
            <div className={BOX}>
              {checkIns.records.slice(0, SHOWN).map((r) => {
                const by = (r.user_id && p.teamMemberNames[r.user_id]) || r.user_email;
                return (
                  <div key={r.id} className={ROW}>
                    <span className="min-w-0 flex-1 truncate">{shortDate(r.created_at, "md")} · {by}</span>
                  </div>
                );
              })}
              <ViewAll n={checkIns.records.length} onClick={() => p.openTab("checkins")} />
            </div>
          ) : checkIns.loading ? (
            <EmptyRow text="Loading…" />
          ) : (
            <EmptyRow text="No visits yet" cta="Check in" onCta={checkIns.openCheckIn} />
          )}
        </Section>
      )}
    </div>
  );
}
