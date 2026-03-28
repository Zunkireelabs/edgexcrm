export type UserRole = "owner" | "admin" | "viewer" | "counselor";

// Industry types for tenant classification
export type IndustryId =
  | "education_consultancy"
  | "it_agency"
  | "construction"
  | "real_estate"
  | "healthcare"
  | "recruitment"
  | "general";

export interface PipelineStageTemplate {
  name: string;
  slug: string;
  position: number;
  color: string;
  is_default: boolean;
  is_terminal: boolean;
}

export interface Industry {
  id: IndustryId;
  name: string;
  description: string | null;
  entity_type_label: string;
  entity_type_singular: string;
  icon: string | null;
  default_pipeline_stages: PipelineStageTemplate[];
  created_at: string;
}

export interface TenantEntity {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string;
  config: TenantConfig;
  industry_id: IndustryId | null;
  created_at: string;
  updated_at: string;
}

export interface TenantConfig {
  contact_phone?: string;
  contact_email?: string;
  contact_whatsapp?: string;
  post_submit_redirect?: string;
  statuses?: string[];
  max_file_size_mb?: number;
  accepted_file_types?: string[];
}

export interface TenantUser {
  id: string;
  tenant_id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
}

export interface Lead {
  id: string;
  tenant_id: string;
  session_id: string | null;
  step: number;
  is_final: boolean;
  status: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  custom_fields: Record<string, unknown>;
  file_urls: Record<string, string>;
  stage_id: string | null;
  assigned_to: string | null;
  entity_id: string | null;
  intake_source: string | null;
  intake_medium: string | null;
  intake_campaign: string | null;
  preferred_contact_method: string | null;
  form_config_id: string | null;
  deleted_at: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadNote {
  id: string;
  lead_id: string;
  user_id: string;
  user_email: string;
  content: string;
  created_at: string;
}

export interface FormConfig {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  steps: FormStep[];
  branding: FormBranding;
  redirect_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormStep {
  title: string;
  fields: FormField[];
}

export interface FormField {
  name: string;
  label: string;
  type:
    | "text"
    | "email"
    | "tel"
    | "select"
    | "file"
    | "textarea"
    | "checkbox"
    | "radio"
    | "date"
    | "number"
    | "entity_select";
  required: boolean;
  placeholder?: string;
  options?: { label: string; value: string; dial_code?: string }[];
  width?: "half" | "third" | "two-thirds" | "full";
  country_field?: string;
  terms_url?: string;
  conditional?: { field: string; values: string[] };
  validation?: {
    pattern?: string;
    max_size_mb?: number;
    accepted_types?: string[];
    min?: number;
    max?: number;
    min_date?: string;
    max_date?: string;
  };
}

export interface FormBranding {
  title: string;
  subtitle?: string;
  primary_color: string;
  logo_url?: string;
  thank_you_title?: string;
  thank_you_message?: string;
  button_color?: string;
  button_text?: string;
  hide_labels?: boolean;
  input_bg_color?: string;
  input_border_radius?: string;
  privacy_url?: string;
}

export interface AuditLog {
  id: string;
  tenant_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface Event {
  id: string;
  tenant_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  last_error: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface PipelineStage {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  position: number;
  color: string;
  is_default: boolean;
  is_terminal: boolean;
  created_at: string;
  updated_at: string;
}

export interface InviteToken {
  id: string;
  tenant_id: string;
  email: string;
  role: "admin" | "viewer" | "counselor";
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_by: string;
  created_at: string;
}

export interface LeadChecklist {
  id: string;
  lead_id: string;
  tenant_id: string;
  title: string;
  is_completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PipelineLead extends Lead {
  checklist_total: number;
  checklist_completed: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface IntegrationKey {
  id: string;
  tenant_id: string;
  name: string;
  hashed_key: string;
  permissions: string[];
  permissions_detail: Record<string, unknown>;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface IntegrationIdempotency {
  id: string;
  tenant_id: string;
  idempotency_key: string;
  endpoint: string;
  response: Record<string, unknown>;
  created_at: string;
}

export interface WebhookEndpoint {
  id: string;
  tenant_id: string;
  url: string;
  secret: string;
  event_types: string[];
  is_active: boolean;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt: number;
  status_code: number | null;
  response_body: string | null;
  success: boolean;
  created_at: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
}
