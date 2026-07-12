"use client";

import { Globe } from "lucide-react";
import { LookupTableManager } from "./lookup-table-manager";

export function CountriesManager() {
  return (
    <LookupTableManager
      id="countries"
      title="Destination Countries"
      icon={Globe}
      apiPath="/api/v1/countries"
      itemLabel="Country"
      description="Manage destination countries that appear in lead forms."
      namePlaceholder="e.g. United Kingdom"
      descriptionPlaceholder="Optional notes about this country"
      emptyMessage="No countries yet. Add countries to use them in lead forms."
    />
  );
}
