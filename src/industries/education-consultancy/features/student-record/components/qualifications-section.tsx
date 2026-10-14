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
  passedYear: string;
  streamFaculty: string;
}

export interface Qualifications {
  see: QualificationEntry;
  plusTwo: QualificationEntry;
  bachelor: QualificationEntry;
  masters: QualificationEntry;
}

function emptyEntry(): QualificationEntry {
  return { institution: "", address: "", awardingBody: "", startDate: "", endDate: "", percentageGrade: "", passedYear: "", streamFaculty: "" };
}

export function emptyQualifications(): Qualifications {
  return { see: emptyEntry(), plusTwo: emptyEntry(), bachelor: emptyEntry(), masters: emptyEntry() };
}

/** "YYYY-MM-DD" for a date input, from a DATE column (which may arrive with a time part) — "" when there is none. */
function dateText(value: string | null | undefined): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(value ?? "")?.[0] ?? "";
}

function yearText(year: number | string | null | undefined): string {
  return year === null || year === undefined ? "" : String(year);
}

/**
 * Everything a qualification card shows comes from the lead's real columns: institution / grade / passed year
 * (migration 159) and address / awarding body / start & end date / stream (migration 236). Nothing here is a local-only
 * "preview" — a field the card shows that is not read here would come back empty after a refresh.
 */
export function qualificationsFromLead(lead: Lead): Qualifications {
  return {
    see: {
      ...emptyEntry(),
      institution: lead.see_institution ?? "",
      address: lead.see_address ?? "",
      awardingBody: lead.see_awarding_body ?? "",
      startDate: dateText(lead.see_start_date),
      endDate: dateText(lead.see_end_date),
      percentageGrade: lead.see_gpa ?? "",
      passedYear: yearText(lead.see_passed_year),
    },
    plusTwo: {
      ...emptyEntry(),
      institution: lead.plus_two_institution ?? "",
      address: lead.plus_two_address ?? "",
      awardingBody: lead.plus_two_awarding_body ?? "",
      startDate: dateText(lead.plus_two_start_date),
      endDate: dateText(lead.plus_two_end_date),
      percentageGrade: lead.plus_two_gpa ?? "",
      passedYear: yearText(lead.plus_two_passed_year),
      streamFaculty: lead.plus_two_stream_faculty ?? "",
    },
    bachelor: {
      ...emptyEntry(),
      institution: lead.bachelor_institution ?? "",
      address: lead.bachelor_address ?? "",
      awardingBody: lead.bachelor_awarding_body ?? "",
      startDate: dateText(lead.bachelor_start_date),
      endDate: dateText(lead.bachelor_end_date),
      percentageGrade: lead.bachelor_gpa ?? "",
      passedYear: yearText(lead.bachelor_passed_year),
      streamFaculty: lead.bachelor_stream_faculty ?? "",
    },
    masters: {
      ...emptyEntry(),
      institution: lead.masters_institution ?? "",
      address: lead.masters_address ?? "",
      awardingBody: lead.masters_awarding_body ?? "",
      startDate: dateText(lead.masters_start_date),
      endDate: dateText(lead.masters_end_date),
      percentageGrade: lead.masters_gpa ?? "",
      passedYear: yearText(lead.masters_passed_year),
      streamFaculty: lead.masters_stream_faculty ?? "",
    },
  };
}

type Tier = "ug" | "pg" | "phd";

/** Short forms of degrees, matched whole (a substring test on "ma" or "ba" would hit unrelated words). */
const UG_CODES = new Set(["ug", "ba", "bsc", "bba", "bca", "bcom", "btech", "be", "beng", "bed", "llb"]);
const PG_CODES = new Set(["pg", "ma", "msc", "mba", "mca", "mcom", "mtech", "me", "meng", "med", "llm", "mphil"]);

/**
 * `degree_level` is a tenant-configurable catalog value (study_levels table), not a fixed enum, so any
 * spelling can show up ("Under Graduate", "Master's", "B.Sc.", "Diploma", ...). It is matched by keyword,
 * ignoring case, spaces, hyphens and punctuation — "Under Graduate" once fell through to "no degree
 * level" and the Academic Information section showed nothing.
 *
 * The one rule that must never break: a level that IS chosen always shows qualifications. Wording we do
 * not recognise (Diploma, Foundation, Certificate, a tenant's own invention) gets the base two — Grade X
 * and Grade XI & XII — which every student has, instead of an empty section. Only a blank level
 * returns null, and that alone shows the "Set a Degree Level" notice.
 */
export function qualificationTier(degreeLevel: string): Tier | null {
  const v = degreeLevel.toLowerCase().replace(/[^a-z]/g, "");
  if (!v) return null;
  if (v.includes("phd") || v.includes("doctor") || v === "dphil" || v.includes("postdoc")) return "phd";
  if (v.includes("post") || v.includes("master") || PG_CODES.has(v)) return "pg";
  if (v.includes("undergrad") || v.includes("bachelor") || UG_CODES.has(v)) return "ug";
  return "ug";
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
    { key: "passedYear", label: "Passed Year", type: "text", placeholder: "e.g. 2021" },
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
                  label="Attach"
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
