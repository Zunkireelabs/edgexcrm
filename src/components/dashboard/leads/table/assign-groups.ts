// EDGEX-127: Assign palette grouping — role labels and plural group headings.

/** Capitalise, mapping the base role `counselor` to the product's "Counsellor". */
export function roleLabel(role: string | null | undefined): string {
  const r = (role ?? "").trim();
  if (!r) return "";
  if (r.toLowerCase() === "counselor") return "Counsellor";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

/** "Counsellor" → "Counsellors", "Branch" → "Branches". "Other" is left alone. */
export function pluralGroup(label: string): string {
  if (!label || label === "Other") return label;
  return /(s|sh|ch|x)$/i.test(label) ? `${label}es` : `${label}s`;
}

/** Group heading for an assignable member: position (or base role) label, pluralised. */
export function assignGroup(position: string | null | undefined, baseRole: string | null | undefined): string {
  const label = roleLabel(position ?? baseRole);
  return label ? pluralGroup(label) : "People";
}
