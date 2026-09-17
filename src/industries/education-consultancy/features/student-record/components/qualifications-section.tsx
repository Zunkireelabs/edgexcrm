"use client";

import { Info } from "lucide-react";
import type { Lead } from "@/types/database";
import { CardSection, FieldGrid, EditableField, type FieldDef } from "./form-primitives";
import { AttachDocumentButton } from "./attach-document-button";
import type { QualificationLevel } from "@/industries/education-consultancy/features/applicant-documents/document-upload-dialog";

export interface QualificationEntry {
  institution: string;
  address: string;
  awardingBody: string;
  startDate: string;
  endDate: string;
  percentageGrade: string;
  streamFaculty: string;
}

export interface Qualifications {
  see: QualificationEntry;
  plusTwo: QualificationEntry;
  bachelor: QualificationEntry;
  masters: QualificationEntry;
}

function emptyEntry(): QualificationEntry {
  return { institution: "", address: "", awardingBody: "", startDate: "", endDate: "", percentageGrade: "", streamFaculty: "" };
}

export function emptyQualifications(): Qualifications {
  return { see: emptyEntry(), plusTwo: emptyEntry(), bachelor: emptyEntry(), masters: emptyEntry() };
}

/**
 * Auto-fills only what genuinely already exists (migration 159's per-level
 * GPA/institution columns) — Address, Awarding Body, Start Date, and End Date
 * have no existing data anywhere, so they start blank rather than guessing.
 */
export function qualificationsFromLead(lead: Lead): Qualifications {
  return {
    see: { ...emptyEntry(), institution: lead.see_institution ?? "", percentageGrade: lead.see_gpa ?? "" },
    plusTwo: { ...emptyEntry(), institution: lead.plus_two_institution ?? "", percentageGrade: lead.plus_two_gpa ?? "" },
    bachelor: { ...emptyEntry(), institution: lead.bachelor_institution ?? "", percentageGrade: lead.bachelor_gpa ?? "" },
    masters: { ...emptyEntry(), institution: lead.masters_institution ?? "", percentageGrade: lead.masters_gpa ?? "" },
  };
}

type Tier = "ug" | "pg" | "phd";

/**
 * `degree_level` is a tenant-configurable catalog value (study_levels table),
 * not a fixed enum — matched by keyword rather than exact string so a
 * tenant's own wording ("Master's", "Postgraduate Diploma", etc.) still
 * resolves correctly instead of only matching one exact label.
 */
export function qualificationTier(degreeLevel: string): Tier | null {
  const v = degreeLevel.toLowerCase();
  if (v.includes("phd") || v.includes("doctor")) return "phd";
  if (v.includes("post") || v.includes("master")) return "pg";
  if (v.includes("undergrad") || v.includes("bachelor")) return "ug";
  return null;
}

interface LevelMeta {
  key: keyof Qualifications;
  title: string;
  hasStream: boolean;
  awardingBodyPlaceholder?: string;
  visibleFor: readonly Tier[];
}

const LEVELS: readonly LevelMeta[] = [
  { key: "see", title: "Qualification 1 — Secondary Education Examination (Grade X)", hasStream: false, awardingBodyPlaceholder: "National Examination Board", visibleFor: ["ug", "pg", "phd"] },
  { key: "plusTwo", title: "Qualification 2 — School Leaving Certificate (Grade XI & XII)", hasStream: true, awardingBodyPlaceholder: "National Examination Board", visibleFor: ["ug", "pg", "phd"] },
  { key: "bachelor", title: "Qualification 3 — Undergraduate", hasStream: true, visibleFor: ["pg", "phd"] },
  { key: "masters", title: "Qualification 4 — Postgraduate", hasStream: true, visibleFor: ["phd"] },
];

// `Qualifications` keys are camelCase (matches the rest of this dialog's JS
// naming); the document link and the `leads` column prefixes are snake_case
// (matches migration 159/236's actual column names) — this is the one place
// that mapping needs to happen.
const QUALIFICATION_DOCUMENT_LEVEL: Record<keyof Qualifications, QualificationLevel> = {
  see: "see",
  plusTwo: "plus_two",
  bachelor: "bachelor",
  masters: "masters",
};

function levelFields(meta: LevelMeta): FieldDef[] {
  const fields: FieldDef[] = [
    { key: "institution", label: "Name of Institution", type: "text" },
    { key: "address", label: "Address of Institution", type: "text" },
    { key: "awardingBody", label: "Awarding Body", type: "text", placeholder: meta.awardingBodyPlaceholder },
    { key: "startDate", label: "Start Date", type: "date" },
    { key: "endDate", label: "End Date", type: "date" },
    { key: "percentageGrade", label: "Percentage / Grade", type: "text" },
  ];
  if (meta.hasStream) fields.push({ key: "streamFaculty", label: "Stream / Faculty / Degree", type: "text" });
  return fields;
}

export function QualificationsSection({
  isEditing,
  degreeLevel,
  value,
  onChange,
  leadId,
  canUploadDocuments,
}: {
  isEditing: boolean;
  degreeLevel: string;
  value: Qualifications;
  onChange: (next: Qualifications) => void;
  leadId: string;
  canUploadDocuments?: boolean;
}) {
  const tier = qualificationTier(degreeLevel);

  if (!tier) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/40 p-4 flex items-start gap-3 text-sm">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Set a Degree Level</span> in Study Interest above to see the relevant qualifications here.
        </p>
      </div>
    );
  }

  const visibleLevels = LEVELS.filter((meta) => meta.visibleFor.includes(tier));

  return (
    <div className="space-y-4">
      {visibleLevels.map((meta) => {
        const entry = value[meta.key];
        const update = (patch: Partial<QualificationEntry>) => onChange({ ...value, [meta.key]: { ...entry, ...patch } });
        return (
          <CardSection
            key={meta.key}
            title={meta.title}
            action={
              canUploadDocuments && (
                <AttachDocumentButton
                  leadId={leadId}
                  defaultDocumentType="marksheet"
                  fixedQualificationLevel={QUALIFICATION_DOCUMENT_LEVEL[meta.key]}
                  label="Attach Marksheet"
                />
              )
            }
          >
            <FieldGrid>
              {levelFields(meta).map((field) => (
                <EditableField
                  key={field.key}
                  field={field}
                  isEditing={isEditing}
                  value={entry[field.key as keyof QualificationEntry]}
                  onChange={(v) => update({ [field.key]: v })}
                />
              ))}
            </FieldGrid>
          </CardSection>
        );
      })}
    </div>
  );
}
