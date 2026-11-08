// Type icon for a filter field (Phosphor via the single icon entry; never lucide).
// Keyed by registry key first, then by field type, so new registry fields still get a sane icon.

import {
  CalendarBlankIcon,
  ClockIcon,
  EnvelopeSimpleIcon,
  GlobeIcon,
  GraduationCapIcon,
  HashIcon,
  LinkSimpleIcon,
  ListIcon,
  MapPinIcon,
  PhoneIcon,
  TagIcon,
  TargetIcon,
  TextTIcon,
  ToggleLeftIcon,
  UserIcon,
  UsersIcon,
  type Icon,
} from "@/components/icons";
import type { FieldDef, FilterFieldType } from "@/lib/filters/types";

const BY_KEY: Record<string, Icon> = {
  stage: TargetIcon,
  status: TargetIcon,
  assignees: UserIcon,
  collaborators: UsersIcon,
  last_activity_at: ClockIcon,
  created: CalendarBlankIcon,
  created_at: CalendarBlankIcon,
  updated_at: CalendarBlankIcon,
  email: EnvelopeSimpleIcon,
  phone: PhoneIcon,
  city: MapPinIcon,
  country: GlobeIcon,
  location: MapPinIcon,
  destinations: GlobeIcon,
  source: LinkSimpleIcon,
  tags: TagIcon,
  field_of_study: GraduationCapIcon,
  degree_level: GraduationCapIcon,
};

const BY_TYPE: Record<FilterFieldType, Icon> = {
  text: TextTIcon,
  number: HashIcon,
  date: CalendarBlankIcon,
  boolean: ToggleLeftIcon,
  select: ListIcon,
  multiselect: ListIcon,
  uuid: UserIcon,
  tags: TagIcon,
  relation: LinkSimpleIcon,
};

/** Renders the field's icon. A component (not a function returning one) so React can see it is static. */
export function FieldIcon({ field, className }: { field: Pick<FieldDef, "key" | "type">; className?: string }) {
  const Glyph = BY_KEY[field.key] ?? BY_TYPE[field.type] ?? TextTIcon;
  return <Glyph className={className} />;
}
