export const TRIP_TYPES = [
  { value: "honeymoon", label: "Honeymoon" },
  { value: "family", label: "Family" },
  { value: "adventure", label: "Adventure" },
  { value: "group_tour", label: "Group Tour" },
  { value: "corporate", label: "Corporate" },
  { value: "pilgrimage", label: "Pilgrimage" },
  { value: "leisure", label: "Leisure" },
  { value: "business", label: "Business" },
  { value: "cruise", label: "Cruise" },
  { value: "mice", label: "MICE" },
] as const;

export const TRIP_TYPE_VALUES = TRIP_TYPES.map((t) => t.value);

export function tripTypeLabel(value?: string | null): string | null {
  return TRIP_TYPES.find((t) => t.value === value)?.label ?? null;
}
