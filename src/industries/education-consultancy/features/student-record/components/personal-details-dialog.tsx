"use client";

import { GUARDIAN_SECTION_TITLE } from "@/lib/consent/guardian";
import { useContext, useEffect, useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { PencilSimpleIcon, XIcon, CheckIcon, CircleNotchIcon, UserIcon } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogKeyHint,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { restoreOrigin } from "../../lead-detail/focus-origin";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Lead } from "@/types/database";
import { NATIONALITY_OPTIONS } from "@/lib/leads/contact-options";
import { ADDRESS_COLUMNS, nextCity, updateAddress, type AddressField, type AddressParts } from "@/lib/leads/address";
import { AddressFields } from "./address-fields";
import { IdentityDocumentFields } from "./identity-document-fields";
import { DestinationsMultiSelect } from "@/components/dashboard/destinations-multi-select";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";
import { getDistinctFormValues, type LeadSubmissionSnapshot } from "@/lib/leads/submission-history";
import { normalizeDestinations, normalizeFieldOfStudy, normalizeDegreeLevel } from "@/lib/leads/destination-normalize";
import { TestScoresSection, testScoresFromLead, legacyScoreColumns, type TestScore } from "./test-scores-section";
import { QualificationsSection, qualificationsFromLead, type Qualifications } from "./qualifications-section";
import { WorkExperienceSection, type WorkExperienceEntry } from "./work-experience-section";
import { ReferencesSection, type ReferenceEntry } from "./references-section";
import { GUARDIAN_RELATIONSHIP_OPTIONS, normalizeGuardianRelationship, guardianNameAfterRelationshipChange, resolveGuardian } from "@/lib/consent/guardian";
import { SectionGroup, CardSection, FieldGrid, EditableField, EditProfileLayoutContext, sentenceCase } from "./form-primitives";
import { useStudentRecordLists } from "./use-student-record-lists";
import { useLeadSourceOptions } from "./use-lead-source-options";
import { SOURCE_FIELD_KIND } from "@/lib/leads/source-options";
import { notifyStudentRecordChanged } from "./student-record-events";
import { buildListsPayload, storedListsToState, type StoredLists } from "./student-record-lists";
import { AttachDocumentButton } from "./attach-document-button";
import { PERSONAL_DETAIL_COLUMNS, PERSONAL_DETAIL_DATE_COLUMNS } from "@/lib/leads/personal-details";
import { FINANCIAL_COLUMNS } from "@/lib/leads/student-record-columns";
import { getLeadCity, getLeadNationality } from "@/lib/leads/lead-location";
import { PROFILE_SECTIONS, firstGapSection, missingBySection, type ProfileSectionId } from "./profile-sections";

/**
 * Personal / passport / citizenship details are real `leads` columns
 * (migration 234) and save through PATCH /api/v1/leads/[id] with everything
 * else. Fields with no column or table yet (Financial, richer Qualification
 * fields, Work Experience, References) are still kept in this component's
 * local state only — preview-only — so they are NOT sent.
 *
 * Study Interest is the exception: those columns (destinations, field_of_study,
 * degree_level, intake_term) already exist on `leads`, so that section is
 * pre-filled from the real lead record, matching the auto-fill rule applied
 * everywhere else in this dialog.
 */
// Real `leads` columns — this pop-up is the page's single editor (the one Edit button on
// the contact card opens it), so these save live the same way Study Interest does.
export const CORE_IDENTITY_FIELDS = [
  { key: "firstName", label: "First Name", type: "text" },
  { key: "lastName", label: "Last Name", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "nationality", label: "Nationality", type: "select", options: NATIONALITY_OPTIONS },
  { key: "city", label: "City", type: "text" },
] as const;

// Owner/admin-only on the server (applyLeadPatch rejects these fields for anyone else), so
// this whole section is only shown — and only ever sent — for admins.
export const LEAD_SOURCE_FIELDS = [
  // The first three are dropdowns (options come from src/lib/leads/source-options.ts + what an admin adds); Campaign stays free text.
  { key: "source", label: "Source Category", type: "select" },
  { key: "medium", label: "Source Channel", type: "select" },
  { key: "account", label: "Source Page / Account", type: "select" },
  { key: "campaign", label: "Campaign", type: "text", placeholder: "e.g. spring-2025" },
] as const;

export const PERSONAL_DETAIL_FIELDS = [
  { key: "date_of_birth", label: "Date of Birth", type: "date" },
  { key: "marital_status", label: "Marital Status", type: "select", options: [{ value: "unmarried", label: "Unmarried" }, { value: "married", label: "Married" }] },
  { key: "father_name", label: "Father's Name", type: "text" },
  { key: "mother_name", label: "Mother's Name", type: "text" },
  // Address lives in Personal Information (AddressFields). Emergency Contact is no longer asked here — the
  // the guardian section below already captures a contact person; the old columns stay, untouched.
] as const;

// The ONE guardian shown on the consent form's Parent/Guardian section (migrations 266, 269).
// Picking Father / Mother pre-fills Guardian Name from the parent names above; for anyone else, type it.
// "None / Not applicable" prints N/A on the form instead of blocking the consent.
export const GUARDIAN_FIELDS = [
  { key: "guardian_relationship", label: "Guardian Relationship", type: "select", options: GUARDIAN_RELATIONSHIP_OPTIONS },
  { key: "guardian_name", label: "Guardian Name", type: "text", placeholder: "e.g. Sita Sharma" },
  { key: "guardian_phone", label: "Guardian Phone", type: "tel" },
  { key: "guardian_email", label: "Guardian Email", type: "email" },
] as const;

// Not part of the client's original PDF template — flagged there as a
// generic "standard fields for completeness" addition, so it may change
// pending client confirmation.
export const FINANCIAL_FIELDS = [
  { key: "sponsor_name", label: "Sponsor Name", type: "text" },
  { key: "sponsor_relationship", label: "Relationship to Applicant", type: "text" },
  { key: "source_of_funds", label: "Source of Funds", type: "text", placeholder: "e.g. Cash or Bank Loan" },
  { key: "scholarship_loan", label: "Scholarship / Loan (if any)", type: "text" },
] as const;

type FieldValues = Record<string, string>;

/** A relationship typed before the dropdown existed (e.g. "Step-father") must still show, and survive a save. */
function withLegacyRelationshipOption<F extends { key: string; options?: readonly { value: string; label: string }[] }>(
  field: F,
  current: string | undefined,
): F {
  if (field.key !== "guardian_relationship" || !current || field.options?.some((o) => o.value === current)) return field;
  return { ...field, options: [...(field.options ?? []), { value: current, label: current }] };
}

export interface StudyInterest {
  destinations: string[];
  fieldOfStudy: string;
  degreeLevel: string;
  intakeMonth: string;
  intakeYear: string;
}

export function studyInterestFromLead(lead: Lead, submissionHistory?: LeadSubmissionSnapshot[]): StudyInterest {
  // `intake_term` exists on the `leads` table (migration 233) but isn't yet
  // declared on the `Lead` type — same gap key-info-section.tsx's
  // StudyInterestPanel works around with this same inline cast.
  const leadWithIntake = lead as Lead & { intake_term?: string | null };
  const [storedMonth, storedYear] = (leadWithIntake.intake_term ?? "").trim().split(/\s+/).filter(Boolean);

  // Same "effective value" fallback the CRM's existing Study Interest panel
  // (key-info-section.tsx) already uses: prefer the lead's dedicated column,
  // and only fall back to scanning form submission history when that column
  // is empty — a lead can arrive with the real answer sitting in a raw form
  // submission that was never backfilled into the column.
  const cf = (lead.custom_fields || {}) as Record<string, unknown>;
  const distinctFieldOfStudy = [...new Set(
    getDistinctFormValues(cf, submissionHistory, "field_of_study")
      .map((v) => normalizeFieldOfStudy(v))
      .filter((v): v is string => !!v)
  )];
  const distinctDegreeLevel = [...new Set(
    getDistinctFormValues(cf, submissionHistory, "education_level")
      .map((v) => normalizeDegreeLevel(v))
      .filter((v): v is string => !!v)
  )];
  const destinations = (lead.destinations?.length ?? 0) > 0
    ? normalizeDestinations(lead.destinations ?? [])
    : normalizeDestinations(getDistinctFormValues(cf, submissionHistory, "countries"));

  return {
    destinations,
    fieldOfStudy: lead.field_of_study || distinctFieldOfStudy[0] || "",
    degreeLevel: lead.degree_level || distinctDegreeLevel[0] || "",
    intakeMonth: storedMonth ?? "",
    intakeYear: storedYear ?? "",
  };
}

export interface CoreIdentity {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  nationality: string;
  city: string;
  country: string;
  preferredContact: string;
}

export function coreIdentityFromLead(lead: Lead): CoreIdentity {
  return {
    firstName: lead.first_name ?? "",
    lastName: lead.last_name ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    nationality: getLeadNationality(lead) ?? "",
    city: getLeadCity(lead) ?? "",
    country: lead.country ?? "",
    preferredContact: lead.preferred_contact_method ?? "",
  };
}

/**
 * Seeds the Personal / Passport & Citizenship fields from the lead's real columns.
 * DATE columns arrive as `YYYY-MM-DD`; if a source ever hands back a longer value (a timestamp),
 * keep just the calendar date so the date input shows it and change-detection stays accurate.
 */
export function personalDetailsFromLead(lead: Lead): FieldValues {
  const dateColumns: readonly string[] = PERSONAL_DETAIL_DATE_COLUMNS;
  const out: FieldValues = {};
  for (const col of PERSONAL_DETAIL_COLUMNS) {
    const raw = lead[col];
    out[col] = dateColumns.includes(col) ? (/^\d{4}-\d{2}-\d{2}/.exec(raw ?? "")?.[0] ?? "") : (raw ?? "");
  }
  // Financial / sponsor details are real columns too (migration 239).
  for (const col of FINANCIAL_COLUMNS) out[col] = lead[col] ?? "";
  // Older free-text values ("father") line up with the dropdown's options; anything else is kept as typed.
  out.guardian_relationship = normalizeGuardianRelationship(out.guardian_relationship);
  return out;
}

/** The address as the UI edits it: Country lives with the core identity, the rest in the personal-detail values. */
export function addressPartsOf(core: CoreIdentity, values: FieldValues): AddressParts {
  return {
    country: core.country,
    province: values[ADDRESS_COLUMNS.province] ?? "",
    district: values[ADDRESS_COLUMNS.district] ?? "",
    municipality: values[ADDRESS_COLUMNS.municipality] ?? "",
    ward: values[ADDRESS_COLUMNS.ward] ?? "",
    tole: values[ADDRESS_COLUMNS.tole] ?? "",
  };
}

export interface LeadSourceValues {
  source: string;
  medium: string;
  account: string;
  campaign: string;
}

export function leadSourceFromLead(lead: Lead, submissionHistory?: LeadSubmissionSnapshot[]): LeadSourceValues {
  const cf = (lead.custom_fields || {}) as Record<string, unknown>;
  return {
    source: lead.intake_source ?? "",
    // Same fallback the read-only Lead Source panel shows: the raw column, else what the
    // lead's form submissions answered.
    medium: lead.intake_medium || getDistinctFormValues(cf, submissionHistory, "source")[0] || "",
    account: lead.intake_account ?? "",
    campaign: lead.intake_campaign ?? "",
  };
}

const QUALIFICATION_COLUMN_PREFIX: Record<keyof Qualifications, string> = {
  see: "see",
  plusTwo: "plus_two",
  bachelor: "bachelor",
  masters: "masters",
};

/**
 * Only the fields that already have a real column on `leads` today go into
 * this patch — core identity (Full Name/Email/Phone/Nationality), Study
 * Interest, and the legacy per-level Institution/GPA values, all already
 * whitelisted in apply-lead-patch.ts. This pop-up is the page's single editor
 * (opened by the one Edit button on the contact card), so it also carries City, each
 * level's Passed Year, the five exam scores that have a column, and — for admins
 * only — Lead Source. It's held to the "only send what's whitelisted, never guess"
 * rule. The Personal / Passport & Citizenship fields (migration 234), the richer
 * Qualification fields — address, awarding body, start/end date, stream
 * (migration 236) — and the Financial fields (migration 239) are real columns
 * and are included. The only things still left out are Work Experience,
 * References and the per-exam score breakdown: they have a table but no API yet,
 * so they stay on screen only (and are labelled "Not saved yet").
 *
 * Only fields that actually changed from their original (committed) value
 * are included — never blindly resend an untouched field. This isn't just
 * tidiness: apply-lead-patch.ts runs a strict phone-format check on ANY
 * patch that includes `phone` for education_consultancy tenants. A lead
 * whose stored phone number predates that check (or came in slightly
 * malformed some other way) would fail that check every time — and since
 * this function used to resend every core-identity field unconditionally,
 * saving something as unrelated as Study Interest would silently drag that
 * old, already-invalid phone number along and get the *entire* save
 * rejected. Confirmed live in production. Diffing against the original
 * fixes it structurally: an untouched field is never sent, so it can never
 * fail a check nobody asked it to run.
 */
export function buildLivePatch(
  core: CoreIdentity,
  coreOriginal: CoreIdentity,
  study: StudyInterest,
  studyOriginal: StudyInterest,
  qualifications: Qualifications,
  qualificationsOriginal: Qualifications,
  testScores: TestScore[],
  testScoresOriginal: TestScore[],
  /** null for non-admins: Lead Source fields are owner/admin-only, so they're never sent. */
  source: LeadSourceValues | null,
  sourceOriginal: LeadSourceValues,
  /** Personal / Passport & Citizenship field values keyed by column name. */
  personal: FieldValues = {},
  personalOriginal: FieldValues = {}
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const setIfChanged = (key: string, next: unknown, prev: unknown) => {
    if (JSON.stringify(next) !== JSON.stringify(prev)) patch[key] = next;
  };

  setIfChanged("first_name", core.firstName || null, coreOriginal.firstName || null);
  setIfChanged("last_name", core.lastName || null, coreOriginal.lastName || null);
  setIfChanged("email", core.email || null, coreOriginal.email || null);
  setIfChanged("phone", core.phone || null, coreOriginal.phone || null);
  setIfChanged("nationality", core.nationality || null, coreOriginal.nationality || null);
  setIfChanged("city", core.city || null, coreOriginal.city || null);
  setIfChanged("country", core.country || null, coreOriginal.country || null);
  setIfChanged("preferred_contact_method", core.preferredContact || null, coreOriginal.preferredContact || null);

  setIfChanged("destinations", study.destinations, studyOriginal.destinations);
  setIfChanged("field_of_study", study.fieldOfStudy || null, studyOriginal.fieldOfStudy || null);
  setIfChanged("degree_level", study.degreeLevel || null, studyOriginal.degreeLevel || null);
  const intakeTerm = [study.intakeMonth, study.intakeYear].filter(Boolean).join(" ") || null;
  const intakeTermOriginal = [studyOriginal.intakeMonth, studyOriginal.intakeYear].filter(Boolean).join(" ") || null;
  setIfChanged("intake_term", intakeTerm, intakeTermOriginal);

  for (const [level, prefix] of Object.entries(QUALIFICATION_COLUMN_PREFIX) as [keyof Qualifications, string][]) {
    const entry = qualifications[level];
    const entryOriginal = qualificationsOriginal[level];
    setIfChanged(`${prefix}_institution`, entry.institution || null, entryOriginal.institution || null);
    setIfChanged(`${prefix}_gpa`, entry.percentageGrade || null, entryOriginal.percentageGrade || null);
    setIfChanged(`${prefix}_passed_year`, entry.passedYear.trim() || null, entryOriginal.passedYear.trim() || null);
    // Migration 236 columns.
    setIfChanged(`${prefix}_address`, entry.address.trim() || null, entryOriginal.address.trim() || null);
    setIfChanged(`${prefix}_awarding_body`, entry.awardingBody.trim() || null, entryOriginal.awardingBody.trim() || null);
    setIfChanged(`${prefix}_start_date`, entry.startDate || null, entryOriginal.startDate || null);
    setIfChanged(`${prefix}_end_date`, entry.endDate || null, entryOriginal.endDate || null);
    // Grade X (SEE) has no stream column; every level from +2 onward does.
    if (prefix !== "see") {
      setIfChanged(`${prefix}_stream_faculty`, entry.streamFaculty.trim() || null, entryOriginal.streamFaculty.trim() || null);
    }
  }

  // Exam scores: only the five exams with a real column are saved (see legacyScoreColumns).
  const scores = legacyScoreColumns(testScores);
  const scoresOriginal = legacyScoreColumns(testScoresOriginal);
  for (const column of Object.keys(scores)) {
    setIfChanged(column, scores[column] || null, scoresOriginal[column] || null);
  }

  if (source) {
    setIfChanged("intake_source", source.source || null, sourceOriginal.source || null);
    setIfChanged("intake_medium", source.medium || null, sourceOriginal.medium || null);
    setIfChanged("intake_account", source.account || null, sourceOriginal.account || null);
    setIfChanged("intake_campaign", source.campaign || null, sourceOriginal.campaign || null);
  }
  for (const col of [...PERSONAL_DETAIL_COLUMNS, ...FINANCIAL_COLUMNS]) {
    setIfChanged(col, (personal[col] ?? "").trim() || null, (personalOriginal[col] ?? "").trim() || null);
  }
  return patch;
}

interface PersonalDetailsDialogProps {
  lead: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fallback source for Study Interest fields when the lead's dedicated columns are empty but a form submission already answered them. */
  submissionHistory?: LeadSubmissionSnapshot[];
  /** Called with the fields that were actually persisted, so the parent's own `lead` state (and anything else reading it, like the old Study Interest panel) stays in sync without a reload. */
  onLeadUpdate?: (patch: Partial<Lead>) => void;
  /** Gates the "Attach Document" triggers on Passport & Citizenship / each Qualification card — mirrors ApplicantDocumentsCard's own `canManage` (FEATURES.APPLICANT_DOCUMENTS && (canEdit ?? isAdmin)), computed once by the caller so this dialog doesn't re-derive permission logic. */
  canUploadDocuments?: boolean;
  /** When true, the dialog enters edit mode as soon as it opens instead of showing the preview first — used by the inline summary card's "Edit" button so it's a single click, not open-then-click-Edit-again. */
  openInEditMode?: boolean;
  /** Owner/admin — unlocks the Lead Source section (the server only accepts those fields from admins). */
  isAdmin?: boolean;
  /**
   * Set when the dialog was opened because the Applications gate blocked a move: the basic-info parts still
   * missing (consent-form fields such as "First Name", "Email", "Phone", "Field of Study", "Passport Number"). The core ones show in red until filled.
   */
  missingBeforeApplications?: string[];
  /**
   * "sections" = Edit profile (EDGEX-155): the Dialogs v1 form with a 200px section list, always in edit mode, saved with one
   * button. Same fields, same state, same save path as the classic pop-up. Default "classic" is what LeadDetailV2 uses.
   */
  layout?: "classic" | "sections";
  /** Edit profile: J / K pressed with typed changes → Discard confirm → this carries on to the next / previous lead. */
  onNavKey?: (dir: "next" | "prev") => void;
  /** Non-admin, non-assignee collaborator — disables Email/Phone in the Core Identity section (mirrors ContactCard's inline-edit restriction). */
  restrictContactFields?: boolean;
}

/** One entry of Edit profile's section list. At phone width the list is a sideways-scrolling chip row, so the active one scrolls into view. */
function SectionNavButton({ label, count, active, onSelect }: { label: string; count: number; active: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref} type="button" onClick={onSelect} aria-current={active ? "true" : undefined}
      className={`flex h-8 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[14px] outline-none max-[430px]:w-auto max-[430px]:shrink-0 max-[430px]:whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ds-accent/30 ${active ? "bg-ds-hover font-medium text-ds-ink" : "text-ds-muted hover:bg-ds-hover hover:text-ds-ink"}`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && <span aria-label={`${count} missing for consent`} className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ds-warn-soft px-1 text-[11px] font-medium text-ds-warn">{count}</span>}
    </button>
  );
}

/** Shown above a list that is still loading (or failed to load): it cannot be edited until it is known, so it can never be saved over the stored rows. */
function ListsLoadNote({ status, onRetry }: { status: "loading" | "ready" | "error"; onRetry: () => void }) {
  if (status === "ready") return null;
  return (
    <p className="mb-2 text-xs text-muted-foreground">
      {status === "loading" ? (
        "Loading saved entries…"
      ) : (
        <>
          Couldn&apos;t load the saved entries, so they can&apos;t be edited right now.{" "}
          <button type="button" className="underline" onClick={onRetry}>
            Try again
          </button>
        </>
      )}
    </p>
  );
}

export function PersonalDetailsDialog({ lead, open, onOpenChange, submissionHistory, onLeadUpdate, canUploadDocuments, openInEditMode, isAdmin = false, missingBeforeApplications, layout = "classic", onNavKey, restrictContactFields = false }: PersonalDetailsDialogProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [values, setValues] = useState<FieldValues>(() => personalDetailsFromLead(lead));
  const [draft, setDraft] = useState<FieldValues>({});
  const [coreIdentity, setCoreIdentity] = useState<CoreIdentity>(() => coreIdentityFromLead(lead));
  const [coreIdentityDraft, setCoreIdentityDraft] = useState<CoreIdentity>(coreIdentity);
  const [studyInterest, setStudyInterest] = useState<StudyInterest>(() => studyInterestFromLead(lead, submissionHistory));
  const [studyDraft, setStudyDraft] = useState<StudyInterest>(studyInterest);
  // Applications gate: which required basic-info fields are STILL empty right now (so the red clears as the
  // counsellor fills them). Documents are not part of the gate.
  const gateMissing = missingBeforeApplications ?? [];
  const shownCore = isEditing ? coreIdentityDraft : coreIdentity;
  const shownStudy = isEditing ? studyDraft : studyInterest;
  const redKeys = new Set<string>();
  if (gateMissing.includes("First Name") && !shownCore.firstName.trim()) redKeys.add("firstName");
  if (gateMissing.includes("Email") && !shownCore.email.trim()) redKeys.add("email");
  if (gateMissing.includes("Phone") && !shownCore.phone.trim()) redKeys.add("phone");
  if (gateMissing.includes("Field of Study") && !shownStudy.fieldOfStudy.trim()) redKeys.add("fieldOfStudy");
  if (gateMissing.includes("Degree Level") && !shownStudy.degreeLevel.trim()) redKeys.add("degreeLevel");
  // The rest of the missing consent fields (Passport Number, Address, Guardian Name, …) are named in the banner; they
  // live in other sections of this pop-up and aren't highlighted individually.
  const CORE_GATE_LABELS = ["First Name", "Email", "Phone", "Field of Study", "Degree Level"];
  const gateBannerItems = [
    ...[...redKeys].map((k) => ({ firstName: "First Name", email: "Email", phone: "Phone", fieldOfStudy: "Field of Study", degreeLevel: "Degree Level" }[k] as string)),
    ...gateMissing.filter((label) => !CORE_GATE_LABELS.includes(label)),
  ];
  const [qualifications, setQualifications] = useState<Qualifications>(() => qualificationsFromLead(lead));
  const [qualificationsDraft, setQualificationsDraft] = useState<Qualifications>(qualifications);
  const [leadSource, setLeadSource] = useState<LeadSourceValues>(() => leadSourceFromLead(lead, submissionHistory));
  const [leadSourceDraft, setLeadSourceDraft] = useState<LeadSourceValues>(leadSource);
  const { lists: sourceLists, addOption: addSourceOption } = useLeadSourceOptions(isAdmin);

  // Work Experience, References and Test Scores are rows in their own tables: they are loaded from the server when the pop-up opens and
  // saved with PUT /api/v1/leads/[id]/student-record. What is shown is derived from the loaded rows plus the user's own edits (null =
  // untouched), so there is no copy to keep in step. Until they have loaded they are shown read-only, so an empty list that is really
  // "not loaded yet" can never be saved over the stored one.
  const { lists: storedLists, status: listsStatus, reload: reloadLists, setLists: setStoredLists } = useStudentRecordLists(lead, open);
  const listsEditable = listsStatus === "ready";
  const legacyScores = useMemo(() => testScoresFromLead(lead), [lead]);
  const testScores: TestScore[] = listsEditable ? storedLists.testScores : legacyScores;
  const workExperience: WorkExperienceEntry[] = storedLists.workExperience;
  const references: ReferenceEntry[] = storedLists.references;
  const [testScoresEdits, setTestScoresEdits] = useState<TestScore[] | null>(null);
  const [workExperienceEdits, setWorkExperienceEdits] = useState<WorkExperienceEntry[] | null>(null);
  const [referencesEdits, setReferencesEdits] = useState<ReferenceEntry[] | null>(null);
  const testScoresDraft = testScoresEdits ?? testScores;
  const workExperienceDraft = workExperienceEdits ?? workExperience;
  const referencesDraft = referencesEdits ?? references;
  const clearListEdits = () => {
    setTestScoresEdits(null);
    setWorkExperienceEdits(null);
    setReferencesEdits(null);
  };

  // The last municipality City could have been filled from. Changing the province clears the municipality
  // in between, so City is compared against this — not the (now empty) current municipality — to know it is
  // still the auto-filled value and may follow the next pick.
  const lastMunicipalityRef = useRef("");

  const startEditing = () => {
    lastMunicipalityRef.current = values.address_municipality ?? "";
    setDraft(values);
    setCoreIdentityDraft(coreIdentity);
    setStudyDraft(studyInterest);
    setQualificationsDraft(qualifications);
    setLeadSourceDraft(leadSource);
    clearListEdits();
    setIsEditing(true);
  };

  useEffect(() => {
    if (open && openInEditMode) startEditing();
    // startEditing is deliberately omitted: it's a new function reference on
    // every render (not memoized), so including it would re-run this effect
    // — and reset every draft field back to the current saved values — on
    // any unrelated re-render while the dialog happens to be open in edit
    // mode, silently wiping in-progress edits. This should only fire once,
    // on the open/openInEditMode transition itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openInEditMode]);

  const cancelEditing = () => {
    setDraft(values);
    setCoreIdentityDraft(coreIdentity);
    setStudyDraft(studyInterest);
    setQualificationsDraft(qualifications);
    setLeadSourceDraft(leadSource);
    clearListEdits();
    setIsEditing(false);
  };

  // What the user has changed since opening Edit, worked out exactly the way Save sends it. The save, the "Save these changes?" box and the
  // "Discard unsaved changes?" box all use this one answer, so they can never disagree about whether something changed.
  const computeChanges = () => {
    const patch = buildLivePatch(
      coreIdentityDraft, coreIdentity,
      studyDraft, studyInterest,
      qualificationsDraft, qualifications,
      testScoresDraft, testScores,
      isAdmin ? leadSourceDraft : null, leadSource,
      draft, values
    );
    // The three lists are rows in their own tables, saved with PUT after the lead itself. Only lists that changed are sent, and only
    // once they have loaded (never save a list that is really "not loaded yet" over the stored one).
    const listsPayload = listsEditable
      ? buildListsPayload(
          { workExperience: workExperienceDraft, references: referencesDraft, testScores: testScoresDraft },
          { workExperience, references, testScores },
        )
      : {};
    const hasLiveChanges = Object.keys(patch).length > 0;
    const hasListChanges = Object.keys(listsPayload).length > 0;
    return { patch, listsPayload, hasLiveChanges, hasListChanges, hasChanges: hasLiveChanges || hasListChanges };
  };

  // Which question is on screen: confirm a save, or confirm throwing away typed changes (by the Cancel button, or by closing the pop-up).
  const [confirm, setConfirm] = useState<null | "save" | "discard" | "discard-close" | "discard-nav">(null);
  const [navDir, setNavDir] = useState<"next" | "prev" | null>(null);
  // Edit profile: the section on show (null = the first with a gap) and what the consent form still needs.
  const [section, setSection] = useState<ProfileSectionId | null>(null);
  const [gaps, setGaps] = useState<{ missing: string[]; total: number; filled: number } | null>(null);
  useEffect(() => {
    if (!open || layout !== "sections") return;
    let cancelled = false;
    fetch(`/api/v1/leads/${lead.id}/profile-completeness`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { missing?: string[]; total?: number; filled?: number } } | null) => {
        const d = j?.data;
        if (!cancelled && d && Array.isArray(d.missing) && typeof d.total === "number" && typeof d.filled === "number") setGaps({ missing: d.missing, total: d.total, filled: d.filled });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, layout, lead.id]);

  const requestSave = () => {
    // Nothing changed: skip the question, save() just says so.
    if (!computeChanges().hasChanges) void save();
    else setConfirm("save");
  };
  const requestCancel = () => {
    if (computeChanges().hasChanges) setConfirm("discard");
    else cancelEditing();
  };

  const save = async () => {
    const { patch, listsPayload, hasLiveChanges, hasListChanges } = computeChanges();
    setIsSaving(true);
    let listsFailed = false;
    try {
      let saved: Lead | null = null;
      if (hasLiveChanges) {
        const res = await fetch(`/api/v1/leads/${lead.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error("Failed to save");
        // The server answers with the row it actually STORED. That — not what was typed — is what the dialog shows afterwards, so a
        // field that did not persist visibly reverts right away instead of only after a refresh.
        const json = await Promise.resolve().then(() => res.json()).catch(() => null);
        saved = (json?.data ?? null) as Lead | null;
        onLeadUpdate?.(saved ?? patch);
      }

      // Only commit local state after the live save actually succeeded (or there was nothing live to save), so a failed save
      // never silently discards what was typed.
      const fresh = saved ? ({ ...lead, ...saved } as Lead) : null;
      if (fresh) {
        setValues(personalDetailsFromLead(fresh));
        setCoreIdentity(coreIdentityFromLead(fresh));
        setStudyInterest(studyInterestFromLead(fresh, submissionHistory));
        setQualifications(qualificationsFromLead(fresh));
        setLeadSource(leadSourceFromLead(fresh, submissionHistory));
      } else {
        setValues(draft);
        setCoreIdentity(coreIdentityDraft);
        setStudyInterest(studyDraft);
        setQualifications(qualificationsDraft);
        setLeadSource(leadSourceDraft);
      }

      if (hasListChanges) {
        const listsRes = await fetch(`/api/v1/leads/${lead.id}/student-record`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(listsPayload),
        });
        if (!listsRes.ok) {
          listsFailed = true;
          throw new Error("Failed to save the lists");
        }
        // Same rule as above: show what the server STORED.
        const listsJson = await Promise.resolve().then(() => listsRes.json()).catch(() => null);
        setStoredLists(
          listsJson?.data
            ? storedListsToState(listsJson.data as StoredLists, fresh ?? lead)
            : { workExperience: workExperienceDraft, references: referencesDraft, testScores: testScoresDraft },
        );
        notifyStudentRecordChanged(lead.id);
      }
      clearListEdits();
      setIsEditing(false);
      toast.success(hasLiveChanges || hasListChanges ? "Saved." : "Nothing to save — no changes were made.");
      if (layout === "sections") onOpenChange(false);
    } catch {
      toast.error(
        listsFailed
          ? "Your other changes were saved, but the work experience, references or test scores could not be saved. Your entries are still here — try again."
          : "Failed to save — nothing was changed. Your edits are still here, try again.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (key: string, value: string) => {
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      // Keep Guardian Name in step with the relationship (see guardianNameAfterRelationshipChange).
      if (key === "guardian_relationship") {
        next.guardian_name = guardianNameAfterRelationshipChange(value, {
          guardianName: prev.guardian_name,
          fatherName: prev.father_name,
          motherName: prev.mother_name,
        });
      }
      return next;
    });
  };

  const handleCoreChange = (key: keyof CoreIdentity, value: string) => {
    setCoreIdentityDraft((prev) => ({ ...prev, [key]: value }));
  };

  // One edit to the address: clears dependent dropdowns, keeps full_address in step, and lets City
  // follow the municipality (without overwriting a City someone typed).
  const handleAddressPartChange = (field: AddressField, value: string) => {
    const before = { parts: addressPartsOf(coreIdentityDraft, draft), fullAddress: draft.full_address ?? "" };
    const after = updateAddress(before, field, value);
    if (after === before) return;
    // Read before updating the ref: the state updater below runs later, after the ref has moved on.
    const previousMunicipality = lastMunicipalityRef.current;
    if (field === "municipality" && value) lastMunicipalityRef.current = value;
    setCoreIdentityDraft((prev) => ({
      ...prev,
      country: after.parts.country,
      city: field === "municipality" ? nextCity(prev.city, previousMunicipality, value) : prev.city,
    }));
    setDraft((prev) => ({
      ...prev,
      [ADDRESS_COLUMNS.province]: after.parts.province,
      [ADDRESS_COLUMNS.district]: after.parts.district,
      [ADDRESS_COLUMNS.municipality]: after.parts.municipality,
      [ADDRESS_COLUMNS.ward]: after.parts.ward,
      [ADDRESS_COLUMNS.tole]: after.parts.tole,
      full_address: after.fullAddress,
    }));
  };

  const handleSourceChange = (key: keyof LeadSourceValues, value: string) => {
    setLeadSourceDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      if (isSaving) return; // never let a close interrupt an in-flight save
      // Closing (X, Esc, click outside) while editing would silently drop what was typed: ask first.
      if (isEditing && computeChanges().hasChanges) {
        setConfirm("discard-close");
        return;
      }
      setIsEditing(false);
    }
    onOpenChange(next);
  };

  const changedCount = layout === "sections" && confirm !== null ? (() => { const c = computeChanges(); return Object.keys(c.patch).length + Object.keys(c.listsPayload).length; })() : 0;
  const leadDisplayName = [coreIdentity.firstName, coreIdentity.lastName].filter(Boolean).join(" ") || "this student";
  const discardConfirm = (
    <AlertDialog open={confirm !== null} onOpenChange={(next) => { if (!next) setConfirm(null); }}>
      <AlertDialogContent className={layout === "sections" ? "max-w-[min(460px,calc(100%-2rem))]" : undefined} onCloseAutoFocus={layout === "sections" ? restoreOrigin : undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm === "save" ? "Save these changes?" : "Discard your changes?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirm === "save"
              ? "The changes you made will be saved to this student's record."
              : layout === "sections"
                ? <>You edited {changedCount} field{changedCount === 1 ? "" : "s"} on <b className="font-semibold text-ds-ink">{leadDisplayName}</b>. They won&apos;t be saved.</>
                : "You have unsaved changes. If you leave now, what you typed will be lost."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const which = confirm;
              setConfirm(null);
              if (which === "save") void save();
              else if (which === "discard") cancelEditing();
              else if (which === "discard-close" || which === "discard-nav") {
                cancelEditing();
                onOpenChange(false);
                if (which === "discard-nav" && navDir) onNavKey?.(navDir);
              }
            }}
          >
            {confirm === "save" ? "Save" : <>Discard{layout === "sections" && <DialogKeyHint>↵</DialogKeyHint>}</>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const sections = layout === "sections";
  const neededLabels = useMemo(() => new Set((gaps?.missing ?? []).map((l) => l.trim().toLowerCase())), [gaps]);
  const needed = (label: string) => sections && neededLabels.has(label.trim().toLowerCase());
  const shownValues = isEditing ? draft : values;
  const shownCore2 = isEditing ? coreIdentityDraft : coreIdentity;

  // ── The pieces of the form. The classic pop-up stacks them in cards; Edit profile shows one per section. ──
  const personalBlock = (
    <FieldGrid>
      {CORE_IDENTITY_FIELDS.map((field) => (
        <EditableField
          key={field.key}
          field={field}
          isEditing={isEditing}
          value={shownCore2[field.key]}
          onChange={(v) => handleCoreChange(field.key, v)}
          invalid={redKeys.has(field.key)}
          needed={needed(field.label)}
          disabled={restrictContactFields && (field.key === "email" || field.key === "phone")}
        />
      ))}
    </FieldGrid>
  );
  const addressBlock = (
    <AddressFields
      isEditing={isEditing}
      parts={addressPartsOf(shownCore2, shownValues)}
      fullAddress={shownValues.full_address ?? ""}
      onPartChange={handleAddressPartChange}
      onFullAddressChange={(v) => handleChange("full_address", v)}
    />
  );
  const studyBlock = (
    <StudyInterestFields
      isEditing={isEditing}
      value={isEditing ? studyDraft : studyInterest}
      onChange={setStudyDraft}
      invalidFieldOfStudy={redKeys.has("fieldOfStudy")}
      invalidDegreeLevel={redKeys.has("degreeLevel")}
      neededFieldOfStudy={needed("Field of Study")}
      neededDegreeLevel={needed("Degree Level")}
    />
  );
  const basicBlock = (
    <FieldGrid columns={2}>
      {PERSONAL_DETAIL_FIELDS.map((field) => (
        <EditableField
          key={field.key}
          field={field}
          isEditing={isEditing}
          value={shownValues[field.key] || ""}
          onChange={(v) => handleChange(field.key, v)}
          needed={needed(field.label)}
        />
      ))}
    </FieldGrid>
  );
  const guardianBlock = (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        The guardian signs for the student on the consent. Pick the relationship: Father or Mother fills the name in
        from their name above; for anyone else, type the name. Choose &quot;None / Not applicable&quot; if there is no
        guardian.
      </p>
      <FieldGrid>
        {GUARDIAN_FIELDS.map((field) => {
          const shown = shownValues;
          // Father / Mother (picked, or the only parent on file): the consent prints that parent's own
          // name, so show exactly that (locked) instead of a box whose contents the form would ignore.
          const effective = resolveGuardian({
            guardianName: shown.guardian_name,
            guardianRelationship: shown.guardian_relationship,
            fatherName: shown.father_name,
            motherName: shown.mother_name,
          });
          const parentName =
            effective.relationship === "Father" ? (shown.father_name ?? "").trim()
            : effective.relationship === "Mother" ? (shown.mother_name ?? "").trim()
            : "";
          const fromParent = field.key === "guardian_name" && !!parentName;
          const picked = !!normalizeGuardianRelationship(shown.guardian_relationship);
          const note = !fromParent
            ? undefined
            : picked
              ? `Taken from ${effective.relationship}'s Name above. Change it there.`
              : `Defaults to ${effective.relationship} (the only parent on file). Pick a relationship to change it.`;
          return (
            <EditableField
              key={field.key}
              field={withLegacyRelationshipOption(field, shown.guardian_relationship)}
              isEditing={isEditing}
              value={fromParent ? parentName : shown[field.key] || ""}
              onChange={(v) => handleChange(field.key, v)}
              readOnlyNote={note}
              needed={needed(field.label)}
            />
          );
        })}
      </FieldGrid>
    </>
  );
  const attachPassport = canUploadDocuments && <AttachDocumentButton leadId={lead.id} defaultDocumentType="passport" label="Attach Passport / ID" />;
  const passportBlock = <IdentityDocumentFields isEditing={isEditing} values={shownValues} onChange={handleChange} neededLabels={sections ? neededLabels : undefined} />;
  const sourceBlock = (
    <FieldGrid>
      {LEAD_SOURCE_FIELDS.map((field) => {
        // Category / Channel / Page-account are dropdowns; Campaign has no kind and stays a text box.
        const kind = (SOURCE_FIELD_KIND as Record<string, (typeof SOURCE_FIELD_KIND)[keyof typeof SOURCE_FIELD_KIND]>)[field.key];
        return (
          <EditableField
            key={field.key}
            field={kind ? { ...field, options: sourceLists[kind] } : field}
            isEditing={isEditing}
            value={(isEditing ? leadSourceDraft : leadSource)[field.key]}
            onChange={(v) => handleSourceChange(field.key, v)}
            onAddOption={kind && isAdmin ? (label) => addSourceOption(kind, label) : undefined}
          />
        );
      })}
    </FieldGrid>
  );
  const academicBlock = (
    <QualificationsSection
      isEditing={isEditing}
      degreeLevel={(isEditing ? studyDraft : studyInterest).degreeLevel}
      value={isEditing ? qualificationsDraft : qualifications}
      onChange={setQualificationsDraft}
      leadId={lead.id}
      canUploadDocuments={canUploadDocuments}
    />
  );
  const testsBlock = (
    <>
      <ListsLoadNote status={listsStatus} onRetry={reloadLists} />
      <TestScoresSection isEditing={isEditing && listsEditable} value={isEditing ? testScoresDraft : testScores} onChange={setTestScoresEdits} />
    </>
  );
  const workBlock = (
    <>
      <ListsLoadNote status={listsStatus} onRetry={reloadLists} />
      <WorkExperienceSection isEditing={isEditing && listsEditable} value={isEditing ? workExperienceDraft : workExperience} onChange={setWorkExperienceEdits} />
    </>
  );
  const referencesBlock = (
    <>
      <ListsLoadNote status={listsStatus} onRetry={reloadLists} />
      <ReferencesSection isEditing={isEditing && listsEditable} value={isEditing ? referencesDraft : references} onChange={setReferencesEdits} />
    </>
  );
  const fundingBlock = (
    <FieldGrid>
      {FINANCIAL_FIELDS.map((field) => (
        <EditableField
          key={field.key}
          field={field}
          isEditing={isEditing}
          value={shownValues[field.key] || ""}
          onChange={(v) => handleChange(field.key, v)}
        />
      ))}
    </FieldGrid>
  );
  const gateBanner = gateBannerItems.length > 0 && (
    <div role="alert" data-testid="gate-banner" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p className="font-medium">Fill these in before moving to Applications:</p>
      <p className="mt-0.5">{gateBannerItems.join(", ")}</p>
    </div>
  );

  // ── Edit profile (Dialogs v1 form, flow 10): 200px section list + one section at a time. ──
  if (sections) {
    const counts = missingBySection(gaps?.missing ?? []);
    const list = PROFILE_SECTIONS.filter((s) => s.id !== "source" || isAdmin);
    const requested = firstGapSection(gateMissing);
    const activeId = (section && list.some((s) => s.id === section) ? section : null) ?? requested ?? firstGapSection(gaps?.missing ?? []) ?? "personal";
    const active = list.find((s) => s.id === activeId) ?? list[0];
    const body: Record<ProfileSectionId, React.ReactNode> = {
      personal: personalBlock, address: addressBlock, basic: basicBlock, guardian: guardianBlock,
      passport: passportBlock, study: studyBlock, academic: academicBlock, tests: testsBlock,
      work: workBlock, references: referencesBlock, funding: fundingBlock, source: sourceBlock,
    };
    const changed = (() => { const c = computeChanges(); return Object.keys(c.patch).length + Object.keys(c.listsPayload).length; })();
    const fullName = [coreIdentity.firstName, coreIdentity.lastName].filter(Boolean).join(" ");
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          size="form" flush showCloseButton aria-describedby={undefined} onCloseAutoFocus={restoreOrigin}
          onKeyDown={(e) => {
            // J / K mean "next / previous lead" on the page; here they only matter when typed edits would be lost.
            const t = e.target as HTMLElement;
            if (e.metaKey || e.ctrlKey || e.altKey || !/^[jk]$/i.test(e.key)) {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !isSaving) { e.preventDefault(); void save(); }
              return;
            }
            if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || t.getAttribute("role") === "combobox") return;
            if (computeChanges().hasChanges) { e.preventDefault(); setNavDir(e.key.toLowerCase() === "j" ? "next" : "prev"); setConfirm("discard-nav"); }
          }}
        >
          <DialogHeader className="min-h-11 flex-row items-center justify-start gap-2 py-0">
            <UserIcon className="size-[13px] shrink-0 text-[#266df0]" aria-hidden />
            <DialogTitle>Edit profile</DialogTitle>
            <span className="min-w-0 truncate text-[14px] leading-5 text-black/50">{[fullName, gaps ? `${gaps.filled} of ${gaps.total} filled` : null].filter(Boolean).join(" · ")}</span>
          </DialogHeader>
          {/* Phone (≤430): the 200px section list becomes a row of section chips along the top that scrolls sideways; the active one scrolls into view. */}
          <div className="flex min-h-0 flex-1 max-[430px]:flex-col">
            <nav aria-label="Profile sections" className="w-[200px] flex-none overflow-y-auto border-r border-ds-divider p-2 max-[430px]:flex max-[430px]:w-full max-[430px]:gap-1 max-[430px]:overflow-x-auto max-[430px]:overflow-y-hidden max-[430px]:border-b max-[430px]:border-r-0 max-[430px]:[scrollbar-width:none]">
              {list.map((s) => {
                const n = counts[s.id] ?? 0;
                return (
                  <SectionNavButton key={s.id} label={s.label} count={n} active={s.id === active.id} onSelect={() => setSection(s.id)} />
                );
              })}
            </nav>
            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4" data-testid="profile-section-body">
              <EditProfileLayoutContext.Provider value>
                {gateBanner && <div className="mb-4">{gateBanner}</div>}
                <h3 className="m-0 mb-3 text-[14px] font-medium leading-5 text-ds-ink">{active.label}</h3>
                {body[active.id]}
              </EditProfileLayoutContext.Provider>
            </div>
          </div>
          <DialogFooter>
            <span className="mr-auto text-[13px] text-ds-faint">{changed > 0 ? `${changed} field${changed === 1 ? "" : "s"} changed` : ""}</span>
            <Button variant="outline" type="button" onClick={() => handleOpenChange(false)} disabled={isSaving}>Cancel</Button>
            <Button type="button" onClick={() => void save()} disabled={isSaving}>
              {isSaving && <CircleNotchIcon className="size-4 animate-spin" />}Save <DialogKeyHint>⌘↵</DialogKeyHint>
            </Button>
          </DialogFooter>
        </DialogContent>
        {discardConfirm}
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-5xl p-0 gap-0 flex flex-col max-h-[85vh]">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="space-y-1.5">
              <DialogTitle>Student Details</DialogTitle>
              <DialogDescription>
                {isEditing
                  ? "Fill in the student's record — personal, study interest, and more as it's added."
                  : "Preview of the student's record."}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isEditing ? (
                <>
                  <Button variant="ghost" onClick={requestCancel} disabled={isSaving}>
                    <XIcon className="h-3.5 w-3.5 mr-1" />
                    Cancel
                  </Button>
                  <Button onClick={requestSave} disabled={isSaving}>
                    {isSaving ? <CircleNotchIcon className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckIcon className="h-3.5 w-3.5 mr-1" />}
                    Save
                  </Button>
                </>
              ) : (
                <Button onClick={startEditing}>
                  <PencilSimpleIcon className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Everything on this form saves: contact, address, personal and passport details, Study Interest, qualifications, test scores, work experience, references, financial details{isAdmin ? " and Lead Source" : ""}.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7 no-scrollbar">
          {gateBanner}
          <SectionGroup title="Personal Information">
            <CardSection title="From existing lead record">
              {personalBlock}

              {/* Same card as Nationality and City: the client asked for the address "together with" them. */}
              <div className="mt-5 border-t pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Address</p>
                {addressBlock}
              </div>
            </CardSection>
          </SectionGroup>

          {/* Study Interest is the first thing staff need after the contact details, so it sits right under them rather than
              after the long Basic Details / Guardian / Passport block (client request, Oct 13). */}
          <SectionGroup title="Study Interest">
            <CardSection>{studyBlock}</CardSection>
          </SectionGroup>

          <SectionGroup title="Personal Details">
            <CardSection title="Basic Details">{basicBlock}</CardSection>
            <CardSection title={GUARDIAN_SECTION_TITLE}>{guardianBlock}</CardSection>
            <CardSection title="Passport & Citizenship Details" action={attachPassport}>{passportBlock}</CardSection>
          </SectionGroup>

          {isAdmin && (
            <SectionGroup title="Lead Source">
              <CardSection>{sourceBlock}</CardSection>
            </SectionGroup>
          )}

          <SectionGroup title="Academic Information">
            {academicBlock}
            <CardSection title="Test Scores">{testsBlock}</CardSection>
          </SectionGroup>

          <SectionGroup title="Professional Information">
            <CardSection title="Work Experience">{workBlock}</CardSection>
            <CardSection title="References">{referencesBlock}</CardSection>
          </SectionGroup>

          <SectionGroup title="Financial Information">
            <CardSection title="Sponsor / Study Funding">{fundingBlock}</CardSection>
          </SectionGroup>
        </div>
      </DialogContent>

      {discardConfirm}
    </Dialog>
  );
}

/**
 * Unlike the rest of this dialog, these fields already exist on `leads`
 * (destinations, field_of_study, degree_level, intake_term — see migrations
 * 059/233), so this section is pre-filled from the real lead record rather
 * than starting blank. Reuses the same options source (useEduTaxonomy) and
 * destinations picker (DestinationsMultiSelect) as every other "Interested
 * Destination(s)" control in the CRM.
 */
function StudyInterestFields({
  isEditing,
  value,
  onChange,
  invalidFieldOfStudy,
  invalidDegreeLevel,
  neededFieldOfStudy,
  neededDegreeLevel,
}: {
  isEditing: boolean;
  value: StudyInterest;
  onChange: (next: StudyInterest) => void;
  /** Still required before Applications — shown in red. */
  invalidFieldOfStudy?: boolean;
  invalidDegreeLevel?: boolean;
  /** Edit profile: the consent form still needs it. */
  neededFieldOfStudy?: boolean;
  neededDegreeLevel?: boolean;
}) {
  const { destinations: destOptions, fieldsOfStudy, studyLevels, intakeMonths, intakeYears } = useEduTaxonomy();
  const intake = [value.intakeMonth, value.intakeYear].filter(Boolean).join(" ");
  const compact = useContext(EditProfileLayoutContext);
  const L = (t: string) => (compact ? sentenceCase(t) : t);

  return (
    <FieldGrid>
      <div className="col-span-full">
        <p className="text-xs text-muted-foreground mb-1">{L("Interested Destinations")}</p>
        {isEditing ? (
          <DestinationsMultiSelect
            selected={value.destinations}
            onChange={(next) => onChange({ ...value, destinations: next })}
            options={destOptions}
            label=""
            optional={false}
          />
        ) : (
          <p className="text-sm font-medium">
            {value.destinations.length > 0 ? value.destinations.join(", ") : <span className="text-muted-foreground">—</span>}
          </p>
        )}
      </div>

      <div>
        <p className={invalidFieldOfStudy ? "text-xs font-medium text-red-600 mb-1" : "text-xs text-muted-foreground mb-1"}>
          {L("Field of Study")}{invalidFieldOfStudy ? " — required" : ""}
          {neededFieldOfStudy && !invalidFieldOfStudy && <span className="font-normal text-[#b25e09]"> · needed for consent</span>}
        </p>
        {isEditing ? (
          <Select value={value.fieldOfStudy || "__none__"} onValueChange={(v) => onChange({ ...value, fieldOfStudy: v === "__none__" ? "" : v })}>
            <SelectTrigger className={`h-9 text-sm w-full ${invalidFieldOfStudy ? "border-red-500" : ""}`} data-invalid={invalidFieldOfStudy ? "true" : undefined}>
              <SelectValue placeholder="Select field" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__"><span className="text-muted-foreground">Select field</span></SelectItem>
              {fieldsOfStudy.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm font-medium">{value.fieldOfStudy || <span className="text-muted-foreground">—</span>}</p>
        )}
      </div>

      <div>
        <p className={invalidDegreeLevel ? "text-xs font-medium text-red-600 mb-1" : "text-xs text-muted-foreground mb-1"}>
          {L("Degree Level")}{invalidDegreeLevel ? " — required" : ""}
          {neededDegreeLevel && !invalidDegreeLevel && <span className="font-normal text-[#b25e09]"> · needed for consent</span>}
        </p>
        {isEditing ? (
          <Select value={value.degreeLevel || "__none__"} onValueChange={(v) => onChange({ ...value, degreeLevel: v === "__none__" ? "" : v })}>
            <SelectTrigger className={`h-9 text-sm w-full ${invalidDegreeLevel ? "border-red-500" : ""}`} data-invalid={invalidDegreeLevel ? "true" : undefined}>
              <SelectValue placeholder="Select level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__"><span className="text-muted-foreground">Select level</span></SelectItem>
              {studyLevels.map((lvl) => (
                <SelectItem key={lvl} value={lvl}>{lvl}</SelectItem>
              ))}
              {/* A level saved earlier but no longer in the catalog must still show, not look blank. */}
              {value.degreeLevel && !studyLevels.includes(value.degreeLevel) && (
                <SelectItem value={value.degreeLevel}>{value.degreeLevel}</SelectItem>
              )}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm font-medium">{value.degreeLevel || <span className="text-muted-foreground">—</span>}</p>
        )}
      </div>

      <div className="col-span-full">
        <p className="text-xs text-muted-foreground mb-1">{L("Intake")}</p>
        {isEditing ? (
          <div className="grid grid-cols-2 gap-3 max-w-sm">
            <Select value={value.intakeMonth || "__none__"} onValueChange={(v) => onChange({ ...value, intakeMonth: v === "__none__" ? "" : v })}>
              <SelectTrigger className="h-9 text-sm w-full">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__"><span className="text-muted-foreground">Month</span></SelectItem>
                {intakeMonths.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={value.intakeYear || "__none__"} onValueChange={(v) => onChange({ ...value, intakeYear: v === "__none__" ? "" : v })}>
              <SelectTrigger className="h-9 text-sm w-full">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__"><span className="text-muted-foreground">Year</span></SelectItem>
                {intakeYears.map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-sm font-medium">{intake || <span className="text-muted-foreground">—</span>}</p>
        )}
      </div>
    </FieldGrid>
  );
}
