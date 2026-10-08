// Option lists for the lead's Residence Country and Preferred Contact. Shared by the inline Details
// box (other industries) and the education Student Details pop-up, so the two can't offer different
// choices for the same column.
export const RESIDENCE_COUNTRIES = [
  "Nepal", "India", "United States", "United Kingdom", "Canada", "Australia",
  "Germany", "France", "Japan", "China", "Singapore", "UAE", "Other",
] as const;

export const CONTACT_METHODS = [
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "any", label: "Any" },
] as const;
