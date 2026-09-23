"use client";

import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Lead } from "@/types/database";
import { InfoSection } from "@/components/dashboard/lead/info-section";
import { SectionGroup, CardSection, FieldGrid, EditableField } from "./form-primitives";
import { WorkExperienceSection } from "./work-experience-section";
import { ReferencesSection } from "./references-section";
import {
  PERSONAL_DETAIL_FIELDS,
  PASSPORT_CITIZENSHIP_FIELDS,
  FINANCIAL_FIELDS,
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
 * Core Identity (name/email/phone) and Study Interest/Academic Information
 * are deliberately NOT repeated here — they're already shown once in the
 * page's main Personal Information card and Study Interest panel. Showing
 * the same fields twice on one page was reported as confusing (client
 * feedback, 2026-09-23); this card now only previews the fields that are
 * unique to Student Details.
 *
 * Most of these fields (everything except Qualification Institution/GPA,
 * shown separately in the Study Interest panel) have no database column
 * yet — see the "Phase 1 preview build" note in personal-details-dialog.tsx
 * — so on a fresh page load they always render as empty/"—" here too,
 * identical to what the dialog itself shows on a fresh open. Not a bug in
 * this component.
 */
export function StudentDetailsSummaryCard({ onEdit, defaultOpen = true }: StudentDetailsSummaryCardProps) {
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
