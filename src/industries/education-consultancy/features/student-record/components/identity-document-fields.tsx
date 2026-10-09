"use client";

import { EditableField, FieldGrid, type FieldDef } from "./form-primitives";

export interface IdentityDocumentGroup {
  id: "passport" | "citizenship";
  /** The document's number — shown alone on its own line. */
  number: FieldDef;
  /** The rest of the document's details — shown together on the next line. */
  details: readonly FieldDef[];
}

// Client request (Student Details > Passport & Citizenship): each document gets its own group, the
// number on one line and its detail boxes on the next, so passport and citizenship fields never mix
// and are harder to fill in wrongly. The field keys are the existing `leads` columns — nothing here
// changes what is saved. Citizenship has two detail fields today (no expiry/third box exists).
export const IDENTITY_DOCUMENT_GROUPS: readonly IdentityDocumentGroup[] = [
  {
    id: "passport",
    number: { key: "passport_number", label: "Passport Number", type: "text" },
    details: [
      { key: "passport_issued_by", label: "Passport Issued By", type: "text", placeholder: "MOFA, Department of Passport" },
      { key: "passport_issued_date", label: "Passport Issued Date", type: "date" },
      { key: "passport_expiry_date", label: "Passport Expiry Date", type: "date" },
    ],
  },
  {
    id: "citizenship",
    number: { key: "citizenship_number", label: "Citizenship Number", type: "text" },
    details: [
      {
        key: "citizenship_issued_by",
        label: "Citizenship Issued By",
        type: "text",
        placeholder: "Government of Home Minister, District Administration Office",
      },
      { key: "citizenship_issued_date", label: "Citizenship Issued Date", type: "date" },
    ],
  },
];

/** Every column the two groups edit, in order — for tests and anything that needs the flat list. */
export const IDENTITY_DOCUMENT_KEYS: readonly string[] = IDENTITY_DOCUMENT_GROUPS.flatMap((g) => [
  g.number.key,
  ...g.details.map((d) => d.key),
]);

interface IdentityDocumentFieldsProps {
  isEditing: boolean;
  values: Record<string, string>;
  onChange?: (key: string, value: string) => void;
}

/** Passport, then Citizenship: number on its own line, detail boxes on the next. Same in the pop-up and the summary card. */
export function IdentityDocumentFields({ isEditing, values, onChange }: IdentityDocumentFieldsProps) {
  const noop = () => {};
  return (
    <div className="space-y-5">
      {IDENTITY_DOCUMENT_GROUPS.map((group, i) => (
        <div key={group.id} className={i > 0 ? "space-y-4 border-t pt-5" : "space-y-4"} data-document-group={group.id}>
          <FieldGrid>
            <EditableField
              field={group.number}
              isEditing={isEditing}
              value={values[group.number.key] || ""}
              onChange={(v) => (onChange ?? noop)(group.number.key, v)}
            />
          </FieldGrid>
          <FieldGrid>
            {group.details.map((field) => (
              <EditableField
                key={field.key}
                field={field}
                isEditing={isEditing}
                value={values[field.key] || ""}
                onChange={(v) => (onChange ?? noop)(field.key, v)}
              />
            ))}
          </FieldGrid>
        </div>
      ))}
    </div>
  );
}
