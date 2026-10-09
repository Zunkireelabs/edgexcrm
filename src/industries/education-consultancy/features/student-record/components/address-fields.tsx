"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { NATIONALITY_OPTIONS } from "@/lib/leads/contact-options";
import {
  districtOptions,
  isNepal,
  municipalityOptions,
  provinceOptions,
  wardOptions,
  type AddressField,
  type AddressParts,
} from "@/lib/leads/address";
import { EditableField, FieldGrid, type FieldDef } from "./form-primitives";

const toOptions = (names: readonly string[]) => names.map((n) => ({ value: n, label: n }));

/** The Ward dropdown's last choice: for a ward the list does not have (the list comes from public data and could be one short). */
export const OTHER_WARD = "__other_ward__";

/** Keep only digits, drop leading zeros, cap at two digits (the largest real ward number is 35). */
export function sanitizeWardNumber(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+/, "").slice(0, 2);
}

interface AddressFieldsProps {
  isEditing: boolean;
  parts: AddressParts;
  /** The readable address saved in `full_address` — composed for Nepal, typed for other countries. */
  fullAddress: string;
  onPartChange: (field: AddressField, value: string) => void;
  onFullAddressChange: (value: string) => void;
}

/**
 * Student Details > Personal Information > Address. For Nepal: Province > District > Municipality >
 * Ward (each list narrows to the parent above it) plus a typed Tole. Every other country keeps one
 * free-text box. The parent keeps `full_address` in step; see updateAddress() in lib/leads/address.ts.
 */
export function AddressFields({ isEditing, parts, fullAddress, onPartChange, onFullAddressChange }: AddressFieldsProps) {
  const nepal = isNepal(parts.country);
  const hasParts = [parts.province, parts.district, parts.municipality, parts.ward, parts.tole].some((p) => p.trim() !== "");

  // "Other ward…": the counselor needs a ward the list does not offer. Also the state for a saved ward that is
  // outside the list (older data, or a municipality whose count in the data is short), so it is never hidden.
  const wards = wardOptions(parts.district, parts.municipality);
  // Remembered per municipality, so choosing a different municipality starts fresh with no effect needed.
  const [otherWardFor, setOtherWardFor] = useState<string | null>(null);
  const wardIsCustom = otherWardFor === parts.municipality || (parts.ward !== "" && !wards.includes(parts.ward));

  const countryField: FieldDef = { key: "country", label: "Country", type: "select", options: NATIONALITY_OPTIONS };

  if (!isEditing) {
    return (
      <FieldGrid>
        <EditableField field={countryField} isEditing={false} value={parts.country} onChange={() => {}} />
        <div className="sm:col-span-2">
          <EditableField
            field={{ key: "full_address", label: "Address", type: "text" }}
            isEditing={false}
            value={fullAddress}
            onChange={() => {}}
          />
        </div>
      </FieldGrid>
    );
  }

  if (!nepal) {
    return (
      <FieldGrid>
        <EditableField field={countryField} isEditing value={parts.country} onChange={(v) => onPartChange("country", v)} />
        <div className="sm:col-span-2">
          <EditableField
            field={{ key: "full_address", label: "Address", type: "text", placeholder: "Street, city, postal code" }}
            isEditing
            value={fullAddress}
            onChange={onFullAddressChange}
          />
        </div>
      </FieldGrid>
    );
  }

  const municipalities = municipalityOptions(parts.district).map((u) => u.name);

  return (
    <div className="space-y-3">
      <FieldGrid>
        <EditableField field={countryField} isEditing value={parts.country} onChange={(v) => onPartChange("country", v)} />
        <EditableField
          field={{ key: "address_province", label: "Province", type: "select", options: toOptions(provinceOptions()) }}
          isEditing
          value={parts.province}
          onChange={(v) => onPartChange("province", v)}
        />
        <EditableField
          field={{ key: "address_district", label: "District", type: "select", options: toOptions(districtOptions(parts.province)) }}
          isEditing
          value={parts.district}
          onChange={(v) => onPartChange("district", v)}
          disabled={!parts.province}
        />
        <EditableField
          field={{
            key: "address_municipality",
            label: "Municipality / Rural Municipality",
            type: "select",
            options: toOptions(municipalities),
          }}
          isEditing
          value={parts.municipality}
          onChange={(v) => onPartChange("municipality", v)}
          disabled={!parts.district}
        />
        <div className="space-y-2">
          <EditableField
            field={{
              key: "address_ward",
              label: "Ward",
              type: "select",
              options: [...toOptions(wards), { value: OTHER_WARD, label: "Other ward…" }],
            }}
            isEditing
            value={wardIsCustom ? OTHER_WARD : parts.ward}
            onChange={(v) => {
              if (v === OTHER_WARD) {
                setOtherWardFor(parts.municipality);
                onPartChange("ward", "");
              } else {
                setOtherWardFor(null);
                onPartChange("ward", v);
              }
            }}
            disabled={!parts.municipality}
          />
          {wardIsCustom && (
            <Input
              inputMode="numeric"
              aria-label="Ward number"
              placeholder="Ward number"
              value={parts.ward}
              onChange={(e) => onPartChange("ward", sanitizeWardNumber(e.target.value))}
              className="h-9 text-sm"
            />
          )}
        </div>
        <EditableField
          field={{ key: "address_tole", label: "Tole / Street", type: "text", placeholder: "e.g. Baneshwor, near the temple" }}
          isEditing
          value={parts.tole}
          onChange={(v) => onPartChange("tole", v)}
        />
      </FieldGrid>
      {!hasParts && fullAddress.trim() !== "" && (
        <p className="text-xs text-muted-foreground">
          Address on file: <span className="text-foreground">{fullAddress}</span>. It is replaced by the address above once you pick a Province.
        </p>
      )}
    </div>
  );
}
