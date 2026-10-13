"use client";

import { GUARDIAN_SECTION_TITLE } from "@/lib/consent/guardian";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoSection, InfoRow } from "@/components/dashboard/lead/info-section";
import { CollapsibleGroups, SectionGroup, CardSection, FieldGrid, EditableField, NotSavedBadge } from "./form-primitives";
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
 * Everything shown here comes from the lead's real columns, so it matches
 * what the Student Details dialog shows when reopened. The exception is
 * Work Experience and References: they are not stored yet, so they are always
 * empty here and labelled "Not saved yet".
 */
export function StudentDetailsSummaryCard({ lead, onEdit, defaultOpen = true }: StudentDetailsSummaryCardProps) {
  // Personal / Passport & Citizenship and Financial all read from the lead's real columns.
  const values: Record<string, string> = personalDetailsFromLead(lead);

  const leadRecord = lead as unknown as Record<string, unknown>;
  const academicLevelRows = ACADEMIC_LEVELS.map((level) => {
    const read = (suffix: string) => String(leadRecord[`${level.key}_${suffix}`] ?? "").trim();
    const day = (suffix: string) => /^\d{4}-\d{2}-\d{2}/.exec(read(suffix))?.[0] ?? "";
    const start = day("start_date");
    const end = day("end_date");
    return {
      level,
      gpa: read("gpa"),
      institution: read("institution"),
      passedYear: read("passed_year"),
      // Migration 236: address, awarding body, dates and stream, shown after the grade / institution / year.
      details: [read("address"), read("awarding_body"), start && end ? `${start} – ${end}` : start || end, read("stream_faculty")].filter(Boolean),
    };
  }).filter((r) => r.gpa || r.institution || r.passedYear || r.details.length > 0);
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
                  {academicLevelRows.map(({ level, gpa, institution, passedYear, details }) => (
                    <InfoRow
                      key={level.key}
                      label={level.label}
                      value={[gpa, institution, passedYear, ...details].filter(Boolean).join(" · ")}
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
          <CardSection title="Work Experience" action={<NotSavedBadge />}>
            <WorkExperienceSection isEditing={false} value={[]} onChange={noop} />
          </CardSection>
          <CardSection title="References" action={<NotSavedBadge />}>
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
