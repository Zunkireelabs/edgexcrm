"use client";

import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Lead } from "@/types/database";
import { InfoSection } from "@/components/dashboard/lead/info-section";
import { SectionGroup, CardSection, FieldGrid, EditableField } from "./form-primitives";
import { TestScoresSection, testScoresFromLead } from "./test-scores-section";
import { QualificationsSection, qualificationsFromLead } from "./qualifications-section";
import { WorkExperienceSection } from "./work-experience-section";
import { ReferencesSection } from "./references-section";
import {
  CORE_IDENTITY_FIELDS,
  PERSONAL_DETAIL_FIELDS,
  PASSPORT_CITIZENSHIP_FIELDS,
  FINANCIAL_FIELDS,
  coreIdentityFromLead,
  studyInterestFromLead,
} from "./personal-details-dialog";
import type { LeadSubmissionSnapshot } from "@/lib/leads/submission-history";

interface StudentDetailsSummaryCardProps {
  lead: Lead;
  submissionHistory?: LeadSubmissionSnapshot[];
  /** Opens the existing Student Details dialog — the single source of truth for editing. */
  onEdit: () => void;
  defaultOpen?: boolean;
}

const noop = () => {};

/**
 * Read-only inline preview of the same record the "Student Details" popup
 * (personal-details-dialog.tsx) edits — placed on the Overview tab below
 * Recent Notes so the record is visible without opening the dialog. Every
 * field here is rendered via the same components the dialog uses in
 * isEditing={false} mode, so there is no second copy of field-rendering
 * logic to keep in sync; the "Edit" button just opens the real dialog.
 *
 * Most of these fields (everything except Core Identity, Study Interest, and
 * Qualification Institution/GPA) have no database column yet — see the
 * "Phase 1 preview build" note in personal-details-dialog.tsx — so on a
 * fresh page load they always render as empty/"—" here too, identical to
 * what the dialog itself shows on a fresh open. Not a bug in this component.
 */
export function StudentDetailsSummaryCard({ lead, submissionHistory, onEdit, defaultOpen = true }: StudentDetailsSummaryCardProps) {
  const coreIdentity = coreIdentityFromLead(lead);
  const studyInterest = studyInterestFromLead(lead, submissionHistory);
  const qualifications = qualificationsFromLead(lead);
  const testScores = testScoresFromLead(lead);

  // Preview-only fields have no DB column to read from — always "—" here.
  const values: Record<string, string> = {};

  return (
    <InfoSection
      title="Student Details"
      defaultOpen={defaultOpen}
      className="rounded-lg"
      titleClassName="text-base font-semibold text-foreground normal-case tracking-normal"
      headerAction={
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={onEdit}>
          <Pencil className="h-3 w-3 mr-1" />
          Edit
        </Button>
      }
    >
      <div className="space-y-7 pt-2">
        <SectionGroup title="Personal Information">
          <CardSection title="From existing lead record">
            <FieldGrid>
              {CORE_IDENTITY_FIELDS.map((field) => (
                <EditableField key={field.key} field={field} isEditing={false} value={coreIdentity[field.key]} onChange={noop} />
              ))}
            </FieldGrid>
          </CardSection>

          <CardSection title="Basic Details">
            <FieldGrid>
              {PERSONAL_DETAIL_FIELDS.map((field) => (
                <EditableField key={field.key} field={field} isEditing={false} value={values[field.key] || ""} onChange={noop} />
              ))}
            </FieldGrid>
          </CardSection>

          <CardSection title="Passport & Citizenship Details">
            <FieldGrid>
              {PASSPORT_CITIZENSHIP_FIELDS.map((field) => (
                <EditableField key={field.key} field={field} isEditing={false} value={values[field.key] || ""} onChange={noop} />
              ))}
            </FieldGrid>
          </CardSection>
        </SectionGroup>

        <SectionGroup title="Study Interest">
          <CardSection>
            <FieldGrid>
              <div className="col-span-full">
                <p className="text-xs text-muted-foreground mb-1">Interested Destinations</p>
                <p className="text-sm font-medium">
                  {studyInterest.destinations.length > 0 ? studyInterest.destinations.join(", ") : <span className="text-muted-foreground">—</span>}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Field of Study</p>
                <p className="text-sm font-medium">{studyInterest.fieldOfStudy || <span className="text-muted-foreground">—</span>}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Degree Level</p>
                <p className="text-sm font-medium">{studyInterest.degreeLevel || <span className="text-muted-foreground">—</span>}</p>
              </div>
              <div className="col-span-full">
                <p className="text-xs text-muted-foreground mb-1">Intake</p>
                <p className="text-sm font-medium">
                  {[studyInterest.intakeMonth, studyInterest.intakeYear].filter(Boolean).join(" ") || <span className="text-muted-foreground">—</span>}
                </p>
              </div>
            </FieldGrid>
          </CardSection>
        </SectionGroup>

        <SectionGroup title="Academic Information">
          <QualificationsSection
            isEditing={false}
            degreeLevel={studyInterest.degreeLevel}
            value={qualifications}
            onChange={noop}
            leadId={lead.id}
          />
          <CardSection title="Test Scores">
            <TestScoresSection isEditing={false} value={testScores} onChange={noop} />
          </CardSection>
        </SectionGroup>

        <SectionGroup title="Professional Information">
          <CardSection title="Work Experience">
            <WorkExperienceSection isEditing={false} value={[]} onChange={noop} />
          </CardSection>
          <CardSection title="References">
            <ReferencesSection isEditing={false} value={[]} onChange={noop} />
          </CardSection>
        </SectionGroup>

        <SectionGroup title="Financial Information">
          <CardSection title="Sponsor / Study Funding">
            <FieldGrid>
              {FINANCIAL_FIELDS.map((field) => (
                <EditableField key={field.key} field={field} isEditing={false} value={values[field.key] || ""} onChange={noop} />
              ))}
            </FieldGrid>
          </CardSection>
        </SectionGroup>
      </div>
    </InfoSection>
  );
}
