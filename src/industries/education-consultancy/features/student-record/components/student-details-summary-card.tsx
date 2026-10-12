"use client";

import { GUARDIAN_SECTION_TITLE } from "@/lib/consent/guardian";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoSection, InfoRow } from "@/components/dashboard/lead/info-section";
import { CollapsibleGroups, SectionGroup, CardSection, FieldGrid, EditableField } from "./form-primitives";
import { WorkExperienceSection } from "./work-experience-section";
import { ReferencesSection } from "./references-section";
import {
  PERSONAL_DETAIL_FIELDS,
  GUARDIAN_FIELDS,
  FINANCIAL_FIELDS,
  personalDetailsFromLead,
  coreIdentityFromLead,
  addressPartsOf,
} from "./personal-details-dialog";
import { AddressFields } from "./address-fields";
import { IdentityDocumentFields } from "./identity-document-fields";
import { ACADEMIC_LEVELS, TEST_TYPES } from "@/lib/leads/prospect-qualification";
import type { Lead } from "@/types/database";

interface StudentDetailsSummaryCardProps {
  /** Source of the saved Personal / Passport & Citizenship values shown here. */
  lead: Lead;
  /** Opens the existing Student Details dialog — the single source of truth for editing. */
  /** Omit to hide the card's own Edit button — the page's single Edit (top of the contact card) opens the pop-up instead. */
  onEdit?: () => void;
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
 * Core Identity (name/email/phone) and Study Interest (destinations / field of
 * study / degree level / intake) are deliberately NOT repeated here — they're
 * already shown once in the page's contact card and Study Interest panel.
 * Academic Qualification and Test Report & Score live HERE (not in the Study
 * Interest panel, which is limited to those four study fields). Showing
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
export function StudentDetailsSummaryCard({ lead, onEdit, defaultOpen = true }: StudentDetailsSummaryCardProps) {
  // Personal / Passport & Citizenship read from the lead's real columns; the remaining
  // preview-only fields (Financial, etc.) have no DB column — always "—" here.
  const values: Record<string, string> = personalDetailsFromLead(lead);

  const leadRecord = lead as unknown as Record<string, unknown>;
  const academicLevelRows = ACADEMIC_LEVELS.map((level) => ({
    level,
    gpa: String(leadRecord[`${level.key}_gpa`] ?? "").trim(),
    institution: String(leadRecord[`${level.key}_institution`] ?? "").trim(),
    passedYear: String(leadRecord[`${level.key}_passed_year`] ?? "").trim(),
  })).filter((r) => r.gpa || r.institution || r.passedYear);
  const testScoreRows = TEST_TYPES.map((t) => ({
    test: t,
    score: String(leadRecord[`${t.key}_score`] ?? "").trim(),
  })).filter((r) => r.score);

  return (
    <InfoSection
      title="Student Details"
      defaultOpen={defaultOpen}
      className="rounded-lg"
      titleClassName="text-base font-semibold text-foreground normal-case tracking-normal"
      headerAction={
        onEdit ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={onEdit}>
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
        ) : undefined
      }
    >
      {/* Every section heading inside gets a collapse arrow — including any added later. */}
      <CollapsibleGroups>
      <div className="space-y-7 pt-2">
        <SectionGroup title="Personal Information">
          <CardSection title="Address">
            <AddressFields
              isEditing={false}
              parts={addressPartsOf(coreIdentityFromLead(lead), values)}
              fullAddress={values.full_address ?? ""}
              onPartChange={noop}
              onFullAddressChange={noop}
            />
          </CardSection>

          <CardSection title="Basic Details">
            <FieldGrid columns={2}>
              {PERSONAL_DETAIL_FIELDS.map((field) => (
                <EditableField key={field.key} field={field} isEditing={false} value={values[field.key] || ""} onChange={noop} />
              ))}
            </FieldGrid>
          </CardSection>

          <CardSection title={GUARDIAN_SECTION_TITLE}>
            <FieldGrid>
              {GUARDIAN_FIELDS.map((field) => (
                <EditableField key={field.key} field={field} isEditing={false} value={values[field.key] || ""} onChange={noop} />
              ))}
            </FieldGrid>
          </CardSection>

          <CardSection title="Passport & Citizenship Details">
            <IdentityDocumentFields isEditing={false} values={values} />
          </CardSection>
        </SectionGroup>

        {(academicLevelRows.length > 0 || testScoreRows.length > 0) && (
          <SectionGroup title="Academic Information">
            {academicLevelRows.length > 0 && (
              <CardSection title="Academic Qualification">
                <div className="px-4 py-2 divide-y">
                  {academicLevelRows.map(({ level, gpa, institution, passedYear }) => (
                    <InfoRow
                      key={level.key}
                      label={level.label}
                      value={[gpa, institution, passedYear].filter(Boolean).join(" · ")}
                    />
                  ))}
                </div>
              </CardSection>
            )}
            {testScoreRows.length > 0 && (
              <CardSection title="Test Report & Score">
                <div className="px-4 py-2 divide-y">
                  {testScoreRows.map(({ test, score }) => (
                    <InfoRow key={test.key} label={test.label} value={score} />
                  ))}
                </div>
              </CardSection>
            )}
          </SectionGroup>
        )}

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
      </CollapsibleGroups>
    </InfoSection>
  );
}
