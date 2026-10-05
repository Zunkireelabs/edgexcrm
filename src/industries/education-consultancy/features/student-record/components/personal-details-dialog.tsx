"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, X, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Lead } from "@/types/database";
import { DestinationsMultiSelect } from "@/components/dashboard/destinations-multi-select";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";
import { getDistinctFormValues, type LeadSubmissionSnapshot } from "@/lib/leads/submission-history";
import { normalizeDestinations, normalizeFieldOfStudy, normalizeDegreeLevel } from "@/lib/leads/destination-normalize";
import { TestScoresSection, testScoresFromLead, legacyScoreColumns, type TestScore } from "./test-scores-section";
import { QualificationsSection, qualificationsFromLead, type Qualifications } from "./qualifications-section";
import { WorkExperienceSection, type WorkExperienceEntry } from "./work-experience-section";
import { ReferencesSection, type ReferenceEntry } from "./references-section";
import { SectionGroup, CardSection, FieldGrid, EditableField } from "./form-primitives";
import { AttachDocumentButton } from "./attach-document-button";
import { PERSONAL_DETAIL_COLUMNS, PERSONAL_DETAIL_DATE_COLUMNS } from "@/lib/leads/personal-details";
import { getLeadCity, getLeadNationality } from "@/lib/leads/lead-location";

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
  { key: "nationality", label: "Nationality", type: "text" },
  { key: "city", label: "City", type: "text" },
] as const;

// Owner/admin-only on the server (applyLeadPatch rejects these fields for anyone else), so
// this whole section is only shown — and only ever sent — for admins.
export const LEAD_SOURCE_FIELDS = [
  { key: "source", label: "Source Category", type: "text", placeholder: "e.g. Social Media, Referral" },
  { key: "medium", label: "Source Channel", type: "text", placeholder: "e.g. Facebook, Google" },
  { key: "account", label: "Source Page / Account", type: "text", placeholder: "e.g. admizz.edu.np" },
  { key: "campaign", label: "Campaign", type: "text", placeholder: "e.g. spring-2025" },
] as const;

export const PERSONAL_DETAIL_FIELDS = [
  { key: "date_of_birth", label: "Date of Birth", type: "date" },
  { key: "marital_status", label: "Marital Status", type: "select", options: [{ value: "unmarried", label: "Unmarried" }, { value: "married", label: "Married" }] },
  { key: "father_name", label: "Father's Name", type: "text" },
  { key: "mother_name", label: "Mother's Name", type: "text" },
  { key: "full_address", label: "Full Address", type: "text", span: 2 },
  { key: "emergency_contact_name", label: "Emergency Contact Name", type: "text" },
  { key: "emergency_contact_phone", label: "Emergency Contact No.", type: "tel" },
] as const;

export const PASSPORT_CITIZENSHIP_FIELDS = [
  { key: "passport_number", label: "Passport Number", type: "text" },
  { key: "passport_issued_by", label: "Passport Issued By", type: "text", placeholder: "MOFA, Department of Passport" },
  { key: "passport_issued_date", label: "Passport Issued Date", type: "date" },
  { key: "passport_expiry_date", label: "Passport Expiry Date", type: "date" },
  { key: "citizenship_number", label: "Citizenship Number", type: "text" },
  { key: "citizenship_issued_by", label: "Citizenship Issued By", type: "text", placeholder: "Government of Home Minister, District Administration Office" },
  { key: "citizenship_issued_date", label: "Citizenship Issued Date", type: "date" },
] as const;

// Guardian contact for the consent form's Parent/Guardian section (migration 266).
// The guardian's name comes from Father's / Mother's Name above.
export const GUARDIAN_FIELDS = [
  { key: "guardian_phone", label: "Guardian Phone", type: "tel" },
  { key: "guardian_email", label: "Guardian Email", type: "email" },
  { key: "guardian_relationship", label: "Guardian Relationship", type: "text", placeholder: "e.g. Father, Uncle" },
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
}

export function coreIdentityFromLead(lead: Lead): CoreIdentity {
  return {
    firstName: lead.first_name ?? "",
    lastName: lead.last_name ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    nationality: getLeadNationality(lead) ?? "",
    city: getLeadCity(lead) ?? "",
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
  return out;
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
 * rule. The Personal / Passport & Citizenship fields (migration 234) are
 * real columns and are included. Everything else this dialog collects (the
 * richer Qualification fields, Work Experience/References, Financial) has no
 * live column or table yet, so it deliberately stays out of this payload —
 * sending it would just 500 against a column that doesn't exist.
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
  for (const col of PERSONAL_DETAIL_COLUMNS) {
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
}

export function PersonalDetailsDialog({ lead, open, onOpenChange, submissionHistory, onLeadUpdate, canUploadDocuments, openInEditMode, isAdmin = false }: PersonalDetailsDialogProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [values, setValues] = useState<FieldValues>(() => personalDetailsFromLead(lead));
  const [draft, setDraft] = useState<FieldValues>({});
  const [coreIdentity, setCoreIdentity] = useState<CoreIdentity>(() => coreIdentityFromLead(lead));
  const [coreIdentityDraft, setCoreIdentityDraft] = useState<CoreIdentity>(coreIdentity);
  const [studyInterest, setStudyInterest] = useState<StudyInterest>(() => studyInterestFromLead(lead, submissionHistory));
  const [studyDraft, setStudyDraft] = useState<StudyInterest>(studyInterest);
  const [testScores, setTestScores] = useState<TestScore[]>(() => testScoresFromLead(lead));
  const [testScoresDraft, setTestScoresDraft] = useState<TestScore[]>([]);
  const [qualifications, setQualifications] = useState<Qualifications>(() => qualificationsFromLead(lead));
  const [qualificationsDraft, setQualificationsDraft] = useState<Qualifications>(qualifications);
  const [workExperience, setWorkExperience] = useState<WorkExperienceEntry[]>([]);
  const [workExperienceDraft, setWorkExperienceDraft] = useState<WorkExperienceEntry[]>([]);
  const [references, setReferences] = useState<ReferenceEntry[]>([]);
  const [referencesDraft, setReferencesDraft] = useState<ReferenceEntry[]>([]);
  const [leadSource, setLeadSource] = useState<LeadSourceValues>(() => leadSourceFromLead(lead, submissionHistory));
  const [leadSourceDraft, setLeadSourceDraft] = useState<LeadSourceValues>(leadSource);

  const startEditing = () => {
    setDraft(values);
    setCoreIdentityDraft(coreIdentity);
    setStudyDraft(studyInterest);
    setTestScoresDraft(testScores);
    setQualificationsDraft(qualifications);
    setWorkExperienceDraft(workExperience);
    setReferencesDraft(references);
    setLeadSourceDraft(leadSource);
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
    setTestScoresDraft(testScores);
    setQualificationsDraft(qualifications);
    setWorkExperienceDraft(workExperience);
    setReferencesDraft(references);
    setLeadSourceDraft(leadSource);
    setIsEditing(false);
  };

  const save = async () => {
    const patch = buildLivePatch(
      coreIdentityDraft, coreIdentity,
      studyDraft, studyInterest,
      qualificationsDraft, qualifications,
      testScoresDraft, testScores,
      isAdmin ? leadSourceDraft : null, leadSource,
      draft, values
    );
    const hasLiveChanges = Object.keys(patch).length > 0;
    setIsSaving(true);
    try {
      if (hasLiveChanges) {
        const res = await fetch(`/api/v1/leads/${lead.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error("Failed to save");
        onLeadUpdate?.(patch);
      }

      // Only commit local state — including the sections that don't persist
      // yet — after the live save actually succeeds (or there was nothing
      // live to save), so a failed save never silently discards what was typed.
      setValues(draft);
      setCoreIdentity(coreIdentityDraft);
      setStudyInterest(studyDraft);
      setTestScores(testScoresDraft);
      setQualifications(qualificationsDraft);
      setWorkExperience(workExperienceDraft);
      setReferences(referencesDraft);
      setLeadSource(leadSourceDraft);
      setIsEditing(false);
      toast.success(
        hasLiveChanges
          ? "Saved. Financial, work experience and reference details are kept locally for preview only — they don't have a database column yet."
          : "Saved locally for preview only — nothing in the real-save fields changed."
      );
    } catch {
      toast.error("Failed to save — nothing was changed. Your edits are still here, try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleCoreChange = (key: keyof CoreIdentity, value: string) => {
    setCoreIdentityDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSourceChange = (key: keyof LeadSourceValues, value: string) => {
    setLeadSourceDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      if (isSaving) return; // never let a close interrupt an in-flight save
      setIsEditing(false);
    }
    onOpenChange(next);
  };

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
                  <Button variant="ghost" onClick={cancelEditing} disabled={isSaving}>
                    <X className="h-3.5 w-3.5 mr-1" />
                    Cancel
                  </Button>
                  <Button onClick={save} disabled={isSaving}>
                    {isSaving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                    Save
                  </Button>
                </>
              ) : (
                <Button onClick={startEditing}>
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Name, email, phone, nationality, city, personal and passport details, Study Interest, qualifications (institution, grade, passed year), the main exam scores{isAdmin ? " and Lead Source" : ""} save for real. Financial, work experience and references are a preview — they save locally for now and will start saving for real once their database update is live.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7 no-scrollbar">
          <SectionGroup title="Personal Information">
            <CardSection title="From existing lead record">
              <FieldGrid>
                {CORE_IDENTITY_FIELDS.map((field) => (
                  <EditableField
                    key={field.key}
                    field={field}
                    isEditing={isEditing}
                    value={(isEditing ? coreIdentityDraft : coreIdentity)[field.key]}
                    onChange={(v) => handleCoreChange(field.key, v)}
                  />
                ))}
              </FieldGrid>
            </CardSection>

            <CardSection title="Basic Details">
              <FieldGrid>
                {PERSONAL_DETAIL_FIELDS.map((field) => (
                  <EditableField
                    key={field.key}
                    field={field}
                    isEditing={isEditing}
                    value={(isEditing ? draft : values)[field.key] || ""}
                    onChange={(v) => handleChange(field.key, v)}
                  />
                ))}
              </FieldGrid>
            </CardSection>

            <CardSection title="Guardian Details">
              <FieldGrid>
                {GUARDIAN_FIELDS.map((field) => (
                  <EditableField
                    key={field.key}
                    field={field}
                    isEditing={isEditing}
                    value={(isEditing ? draft : values)[field.key] || ""}
                    onChange={(v) => handleChange(field.key, v)}
                  />
                ))}
              </FieldGrid>
            </CardSection>

            <CardSection
              title="Passport & Citizenship Details"
              action={
                canUploadDocuments && (
                  <AttachDocumentButton leadId={lead.id} defaultDocumentType="passport" label="Attach Passport / ID" />
                )
              }
            >
              <FieldGrid>
                {PASSPORT_CITIZENSHIP_FIELDS.map((field) => (
                  <EditableField
                    key={field.key}
                    field={field}
                    isEditing={isEditing}
                    value={(isEditing ? draft : values)[field.key] || ""}
                    onChange={(v) => handleChange(field.key, v)}
                  />
                ))}
              </FieldGrid>
            </CardSection>
          </SectionGroup>

          <SectionGroup title="Study Interest">
            <CardSection>
              <StudyInterestFields
                isEditing={isEditing}
                value={isEditing ? studyDraft : studyInterest}
                onChange={setStudyDraft}
              />
            </CardSection>
          </SectionGroup>

          {isAdmin && (
            <SectionGroup title="Lead Source">
              <CardSection>
                <FieldGrid>
                  {LEAD_SOURCE_FIELDS.map((field) => (
                    <EditableField
                      key={field.key}
                      field={field}
                      isEditing={isEditing}
                      value={(isEditing ? leadSourceDraft : leadSource)[field.key]}
                      onChange={(v) => handleSourceChange(field.key, v)}
                    />
                  ))}
                </FieldGrid>
              </CardSection>
            </SectionGroup>
          )}

          <SectionGroup title="Academic Information">
            <QualificationsSection
              isEditing={isEditing}
              degreeLevel={(isEditing ? studyDraft : studyInterest).degreeLevel}
              value={isEditing ? qualificationsDraft : qualifications}
              onChange={setQualificationsDraft}
              leadId={lead.id}
              canUploadDocuments={canUploadDocuments}
            />
            <CardSection title="Test Scores">
              <TestScoresSection
                isEditing={isEditing}
                value={isEditing ? testScoresDraft : testScores}
                onChange={setTestScoresDraft}
              />
            </CardSection>
          </SectionGroup>

          <SectionGroup title="Professional Information">
            <CardSection title="Work Experience">
              <WorkExperienceSection
                isEditing={isEditing}
                value={isEditing ? workExperienceDraft : workExperience}
                onChange={setWorkExperienceDraft}
              />
            </CardSection>
            <CardSection title="References">
              <ReferencesSection
                isEditing={isEditing}
                value={isEditing ? referencesDraft : references}
                onChange={setReferencesDraft}
              />
            </CardSection>
          </SectionGroup>

          <SectionGroup title="Financial Information">
            <CardSection title="Sponsor / Study Funding">
              <FieldGrid>
                {FINANCIAL_FIELDS.map((field) => (
                  <EditableField
                    key={field.key}
                    field={field}
                    isEditing={isEditing}
                    value={(isEditing ? draft : values)[field.key] || ""}
                    onChange={(v) => handleChange(field.key, v)}
                  />
                ))}
              </FieldGrid>
            </CardSection>
          </SectionGroup>
        </div>
      </DialogContent>
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
}: {
  isEditing: boolean;
  value: StudyInterest;
  onChange: (next: StudyInterest) => void;
}) {
  const { destinations: destOptions, fieldsOfStudy, studyLevels, intakeMonths, intakeYears } = useEduTaxonomy();
  const intake = [value.intakeMonth, value.intakeYear].filter(Boolean).join(" ");

  return (
    <FieldGrid>
      <div className="col-span-full">
        <p className="text-xs text-muted-foreground mb-1">Interested Destinations</p>
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
        <p className="text-xs text-muted-foreground mb-1">Field of Study</p>
        {isEditing ? (
          <Select value={value.fieldOfStudy || "__none__"} onValueChange={(v) => onChange({ ...value, fieldOfStudy: v === "__none__" ? "" : v })}>
            <SelectTrigger className="h-9 text-sm w-full">
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
        <p className="text-xs text-muted-foreground mb-1">Degree Level</p>
        {isEditing ? (
          <Select value={value.degreeLevel || "__none__"} onValueChange={(v) => onChange({ ...value, degreeLevel: v === "__none__" ? "" : v })}>
            <SelectTrigger className="h-9 text-sm w-full">
              <SelectValue placeholder="Select level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__"><span className="text-muted-foreground">Select level</span></SelectItem>
              {studyLevels.map((lvl) => (
                <SelectItem key={lvl} value={lvl}>{lvl}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm font-medium">{value.degreeLevel || <span className="text-muted-foreground">—</span>}</p>
        )}
      </div>

      <div className="col-span-full">
        <p className="text-xs text-muted-foreground mb-1">Intake</p>
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
