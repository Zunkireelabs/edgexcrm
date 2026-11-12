import { CalendarIcon, EnvelopeSimpleIcon, GraduationCapIcon, MapPinIcon, NotePencilIcon, PhoneIcon, UserIcon, UsersIcon, WalletIcon, GlobeIcon, LinkIcon, type Icon } from "@/components/icons";
import type { Lead } from "@/types/database";
import { getLeadCity, getLeadNationality } from "@/lib/leads/lead-location";

/**
 * Fields in "View all values". Every key is a column the PATCH route accepts (UPDATABLE_FIELDS), so an edit can never be
 * silently dropped; lead-detail's profile-fields test checks that.
 */
export interface ProfileField {
  key: string;
  label: string;
  icon: Icon;
  type?: "text" | "date";
}

export const PROFILE_FIELDS: ProfileField[] = [
  { key: "first_name", label: "First name", icon: UserIcon },
  { key: "last_name", label: "Last name", icon: UserIcon },
  { key: "phone", label: "Phone", icon: PhoneIcon },
  { key: "email", label: "Email", icon: EnvelopeSimpleIcon },
  { key: "date_of_birth", label: "Date of birth", icon: CalendarIcon, type: "date" },
  { key: "nationality", label: "Nationality", icon: GlobeIcon },
  { key: "city", label: "City", icon: MapPinIcon },
  { key: "full_address", label: "Address", icon: MapPinIcon },
  { key: "father_name", label: "Father's name", icon: UserIcon },
  { key: "mother_name", label: "Mother's name", icon: UserIcon },
  { key: "guardian_name", label: "Guardian", icon: UsersIcon },
  { key: "guardian_relationship", label: "Guardian relationship", icon: UsersIcon },
  { key: "guardian_phone", label: "Guardian phone", icon: PhoneIcon },
  { key: "guardian_email", label: "Guardian email", icon: EnvelopeSimpleIcon },
  { key: "passport_number", label: "Passport no.", icon: NotePencilIcon },
  { key: "passport_expiry_date", label: "Passport expiry", icon: CalendarIcon, type: "date" },
  { key: "see_gpa", label: "SEE GPA", icon: GraduationCapIcon },
  { key: "plus_two_gpa", label: "+2 GPA", icon: GraduationCapIcon },
  { key: "bachelor_gpa", label: "Bachelor GPA", icon: GraduationCapIcon },
  { key: "masters_gpa", label: "Masters GPA", icon: GraduationCapIcon },
  { key: "ielts_score", label: "IELTS", icon: GraduationCapIcon },
  { key: "pte_score", label: "PTE", icon: GraduationCapIcon },
  { key: "toefl_score", label: "TOEFL", icon: GraduationCapIcon },
  { key: "source_of_funds", label: "Funding", icon: WalletIcon },
  { key: "intake_source", label: "Source", icon: LinkIcon },
];

export function profileFieldValue(lead: Lead, key: string): string {
  if (key === "city") return getLeadCity(lead) ?? "";
  if (key === "nationality") return getLeadNationality(lead) ?? "";
  const v = (lead as unknown as Record<string, unknown>)[key];
  return v == null ? "" : String(v);
}
