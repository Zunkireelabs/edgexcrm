"use client";

import type { ReactNode } from "react";
import { BriefcaseIcon, FileTextIcon, GraduationCapIcon, ShieldCheckIcon, UserCheckIcon } from "@/components/icons";
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
  tab, icon, title, count, onOpen, children,
}: {
  tab: TabId; icon: ReactNode; title: string; count?: number | null;
  onOpen: (t: TabId) => void; children: ReactNode;
}) {
  return (
    <section className="mt-2" data-testid={`rail-${tab}`} aria-label={title}>
      <div className="flex h-9 items-center gap-1.5 px-1">
        <button type="button" title={`Open the ${title} tab`} onClick={() => onOpen(tab)} className="flex items-center gap-1.5 rounded-[6px] text-[14px] font-medium leading-5 text-black/[.63] outline-none hover:text-[#101112] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 [&_svg]:size-4">
          {icon}{title}
          {count !== undefined && count !== null && <CountChip>{count}</CountChip>}
        </button>
      </div>
      {children}
    </section>
  );
}

/** Empty section: one 32px row with a ring and muted text. Information only, no call to action. */
function EmptyRow({ text }: { text: string }) {
  return <div className={cn(ROW, "text-black/50 shadow-[inset_0_0_0_1px_#eeeff1]")}><span className="min-w-0 flex-1 truncate">{text}</span></div>;
}

/** "+N more" under a truncated list. Plain text: the section title opens the full tab. */
function More({ n }: { n: number }) {
  if (n <= SHOWN) return null;
  return <p className="m-0 px-2 py-1 text-[12px] text-black/50">+{n - SHOWN} more</p>;
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
 * store as its tab (`LeadFile`), so an edit in one shows in the other. The title opens the tab. The rail itself is information
 * only (client request, Nov 2026): no add / view / edit buttons, those live in the tabs.
 */
export function RightRail(p: RightRailProps) {
  const { file } = p;
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
          <ConsentBox file={file} />
        </section>
      )}

      {p.applicationsActive && (
        <Section
          tab="applications" icon={<BriefcaseIcon />} title="Applications" count={applications.loading ? null : applications.applications.length} onOpen={p.openTab}
        >
          {applications.applications.length > 0 ? (
            <div className={BOX}>
              {applications.applications.slice(0, SHOWN).map((a) => (
                <div key={a.id} className={ROW}>
                  <span className="min-w-0 flex-1 truncate">{a.university_name}{a.program_name ? ` · ${a.program_name}` : ""}</span>
                </div>
              ))}
              <More n={applications.applications.length} />
            </div>
          ) : applications.loading ? (
            <EmptyRow text="Loading…" />
          ) : locked ? (
            <EmptyRow text="Unlocks after consent" />
          ) : (
            <EmptyRow text="No applications yet" />
          )}
        </Section>
      )}

      {p.classesActive && (
        <Section
          tab="classes" icon={<GraduationCapIcon />} title="Classes" count={enrollments.loading ? null : enrollments.enrollments.length} onOpen={p.openTab}
        >
          {enrollments.enrollments.length > 0 ? (
            <div className={BOX}>
              {enrollments.enrollments.slice(0, SHOWN).map((e) => (
                <div key={e.id} className={ROW}>
                  <span className="min-w-0 flex-1 truncate">{e.classes?.name ?? "Unknown class"}</span>
                </div>
              ))}
              <More n={enrollments.enrollments.length} />
            </div>
          ) : enrollments.loadError ? (
            <EmptyRow text="Couldn’t load classes" />
          ) : enrollments.loading ? (
            <EmptyRow text="Loading…" />
          ) : (
            <EmptyRow text="Not enrolled yet" />
          )}
        </Section>
      )}

      {p.documentsActive && (
        <Section
          tab="documents" icon={<FileTextIcon />} title="Documents" count={documents.loading ? null : documents.docs.length} onOpen={p.openTab}
        >
          {documents.docs.length > 0 ? (
            <div className={BOX}>
              {documents.docs.slice(0, SHOWN).map((d) => {
                const e = ext(d.original_filename || d.name, d.mime_type);
                return (
                  <div key={d.id} className={ROW}>
                    <span className={cn("w-[26px] flex-none rounded-[4px] text-center text-[9px] font-semibold leading-4", e.img ? "bg-[#e9f2ff] text-[#1d5bd0]" : "bg-[#fdecea] text-[#b4231a]")}>{e.label}</span>
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  </div>
                );
              })}
              <More n={documents.docs.length} />
            </div>
          ) : documents.loading ? (
            <EmptyRow text="Loading…" />
          ) : (
            <EmptyRow text="No documents yet" />
          )}
        </Section>
      )}

      {p.checkInActive && (
        <Section
          tab="checkins" icon={<UserCheckIcon />} title="Check-ins" count={checkIns.loading ? null : checkIns.records.length} onOpen={p.openTab}
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
              <More n={checkIns.records.length} />
            </div>
          ) : checkIns.loading ? (
            <EmptyRow text="Loading…" />
          ) : (
            <EmptyRow text="No visits yet" />
          )}
        </Section>
      )}
    </div>
  );
}
