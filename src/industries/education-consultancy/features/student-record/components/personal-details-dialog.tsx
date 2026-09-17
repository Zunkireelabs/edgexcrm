"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil, X, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { getLeadFullName } from "@/components/dashboard/lead/lead-name";
import { DestinationsMultiSelect } from "@/components/dashboard/destinations-multi-select";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";
import { getDistinctFormValues, type LeadSubmissionSnapshot } from "@/lib/leads/submission-history";
import { normalizeDestinations, normalizeFieldOfStudy, normalizeDegreeLevel } from "@/lib/leads/destination-normalize";
import { TestScoresSection, testScoresFromLead, type TestScore } from "./test-scores-section";
import { QualificationsSection, qualificationsFromLead, type Qualifications } from "./qualifications-section";
import { WorkExperienceSection, type WorkExperienceEntry } from "./work-experience-section";
import { ReferencesSection, type ReferenceEntry } from "./references-section";
import { SectionGroup, CardSection, FieldGrid, ReadOnlyField, EditableField } from "./form-primitives";

/**
 * Phase 1 preview build: new personal-detail fields live only in this
 * component's local state. The `leads` columns they map to don't exist in
 * any database yet (migration 234 is written but not applied), so nothing
 * here is persisted via the API — this is for visual/UX review only.
 *
 * Study Interest is the exception: those columns (destinations, field_of_study,
 * degree_level, intake_term) already exist on `leads`, so that section is
 * pre-filled from the real lead record, matching the auto-fill rule applied
 * everywhere else in this dialog.
 */
const PERSONAL_DETAIL_FIELDS = [
  { key: "date_of_birth", label: "Date of Birth", type: "date" },
  { key: "marital_status", label: "Marital Status", type: "select", options: [{ value: "unmarried", label: "Unmarried" }, { value: "married", label: "Married" }] },
  { key: "father_name", label: "Father's Name", type: "text" },
  { key: "mother_name", label: "Mother's Name", type: "text" },
  { key: "full_address", label: "Full Address", type: "text", span: 2 },
  { key: "emergency_contact_name", label: "Emergency Contact Name", type: "text" },
  { key: "emergency_contact_phone", label: "Emergency Contact No.", type: "tel" },
] as const;

const PASSPORT_CITIZENSHIP_FIELDS = [
  { key: "passport_number", label: "Passport Number", type: "text" },
  { key: "passport_issued_by", label: "Passport Issued By", type: "text", placeholder: "MOFA, Department of Passport" },
  { key: "passport_issued_date", label: "Passport Issued Date", type: "date" },
  { key: "passport_expiry_date", label: "Passport Expiry Date", type: "date" },
  { key: "citizenship_number", label: "Citizenship Number", type: "text" },
  { key: "citizenship_issued_by", label: "Citizenship Issued By", type: "text", placeholder: "Government of Home Minister, District Administration Office" },
  { key: "citizenship_issued_date", label: "Citizenship Issued Date", type: "date" },
] as const;

// Not part of the client's original PDF template — flagged there as a
// generic "standard fields for completeness" addition, so it may change
// pending client confirmation.
const FINANCIAL_FIELDS = [
  { key: "sponsor_name", label: "Sponsor Name", type: "text" },
  { key: "sponsor_relationship", label: "Relationship to Applicant", type: "text" },
  { key: "source_of_funds", label: "Source of Funds", type: "text", placeholder: "e.g. Cash or Bank Loan" },
  { key: "scholarship_loan", label: "Scholarship / Loan (if any)", type: "text" },
] as const;

type FieldValues = Record<string, string>;

interface StudyInterest {
  destinations: string[];
  fieldOfStudy: string;
  degreeLevel: string;
  intakeMonth: string;
  intakeYear: string;
}

function studyInterestFromLead(lead: Lead, submissionHistory?: LeadSubmissionSnapshot[]): StudyInterest {
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

const QUALIFICATION_COLUMN_PREFIX: Record<keyof Qualifications, string> = {
  see: "see",
  plusTwo: "plus_two",
  bachelor: "bachelor",
  masters: "masters",
};

/**
 * Only the fields that already have a real column on `leads` today go into
 * this patch — Study Interest and the legacy per-level Institution/GPA
 * values, both already whitelisted in apply-lead-patch.ts and already
 * written by the old Study Interest panel. Everything else this dialog
 * collects (new Personal Information fields, the richer Qualification
 * fields, Test Scores/Work Experience/References) has no live column or
 * table yet (migrations 234-239 aren't applied anywhere), so it deliberately
 * stays out of this payload — sending it would just 500 against a column
 * that doesn't exist.
 */
function buildLivePatch(study: StudyInterest, qualifications: Qualifications): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    destinations: study.destinations,
    field_of_study: study.fieldOfStudy || null,
    degree_level: study.degreeLevel || null,
    intake_term: [study.intakeMonth, study.intakeYear].filter(Boolean).join(" ") || null,
  };
  for (const [level, prefix] of Object.entries(QUALIFICATION_COLUMN_PREFIX) as [keyof Qualifications, string][]) {
    const entry = qualifications[level];
    patch[`${prefix}_institution`] = entry.institution || null;
    patch[`${prefix}_gpa`] = entry.percentageGrade || null;
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
}

export function PersonalDetailsDialog({ lead, open, onOpenChange, submissionHistory, onLeadUpdate }: PersonalDetailsDialogProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [values, setValues] = useState<FieldValues>({});
  const [draft, setDraft] = useState<FieldValues>({});
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

  const startEditing = () => {
    setDraft(values);
    setStudyDraft(studyInterest);
    setTestScoresDraft(testScores);
    setQualificationsDraft(qualifications);
    setWorkExperienceDraft(workExperience);
    setReferencesDraft(references);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraft(values);
    setStudyDraft(studyInterest);
    setTestScoresDraft(testScores);
    setQualificationsDraft(qualifications);
    setWorkExperienceDraft(workExperience);
    setReferencesDraft(references);
    setIsEditing(false);
  };

  const save = async () => {
    const patch = buildLivePatch(studyDraft, qualificationsDraft);
    setIsSaving(true);
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed to save");

      // Only commit local state — including the sections that don't persist
      // yet — after the live save actually succeeds, so a failed save never
      // silently discards what was typed.
      setValues(draft);
      setStudyInterest(studyDraft);
      setTestScores(testScoresDraft);
      setQualifications(qualificationsDraft);
      setWorkExperience(workExperienceDraft);
      setReferences(referencesDraft);
      setIsEditing(false);
      onLeadUpdate?.(patch);
      toast.success("Study Interest and Academic Qualification institution/grade saved. Other new fields are saved locally for preview only until the database update is live.");
    } catch {
      toast.error("Failed to save — nothing was changed. Your edits are still here, try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
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
          <DialogTitle>Student Details</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Fill in the student's record — personal, study interest, and more as it's added."
              : "Preview of the student's record."}
          </DialogDescription>
          <p className="text-xs text-muted-foreground">
            Study Interest and Academic Qualification (institution/grade) save for real. Everything else here is a preview — it saves locally for now and will start saving for real once the database update for it is live.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">
          <SectionGroup title="Personal Information">
            <CardSection title="From existing lead record">
              <FieldGrid>
                <ReadOnlyField label="Full Name" value={getLeadFullName(lead, "—")} />
                <ReadOnlyField label="Email" value={lead.email || "—"} />
                <ReadOnlyField label="Phone" value={lead.phone || "—"} />
                <ReadOnlyField label="Nationality" value={lead.nationality || "—"} />
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

            <CardSection title="Passport & Citizenship Details">
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

          <SectionGroup title="Academic Information">
            <QualificationsSection
              isEditing={isEditing}
              degreeLevel={(isEditing ? studyDraft : studyInterest).degreeLevel}
              value={isEditing ? qualificationsDraft : qualifications}
              onChange={setQualificationsDraft}
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

        <DialogFooter className="px-6 py-4 border-t shrink-0">
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
        </DialogFooter>
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
