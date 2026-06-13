export type UserRole = "owner" | "admin" | "viewer" | "counselor";

// Industry types for tenant classification
export type IndustryId =
  | "education_consultancy"
  | "it_agency"
  | "construction"
  | "real_estate"
  | "healthcare"
  | "recruitment"
  | "general"
  | "travel_agency";

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

export interface ConnectedEmailAccount {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: string;
  email: string;
  display_name: string | null;
  refresh_token: string;
  access_token: string | null;
  token_expiry: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailForwardRule {
  id: string;
  tenant_id: string;
  name: string;
  is_active: boolean;
  from_name: string | null;
  pipeline_id: string;
  stage_id: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
  // Joined fields (from API responses)
  pipeline_name?: string;
  stage_name?: string;
  stage_color?: string;
}

export interface TenantUser {
  id: string;
  tenant_id: string;
  user_id: string;
  role: UserRole;
  default_hourly_rate: number | null;
  created_at: string;
}

export interface Lead {
  id: string;
  tenant_id: string;
  pipeline_id: string;
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
  tags: string[];
  lead_type: string;
  display_id: string | null;
  account_id: string | null;
  form_config_id: string | null;
  deleted_at: string | null;
  converted_at: string | null;
  converted_contact_id: string | null;
  idempotency_key: string | null;
  // AI Insights fields
  ai_score: number | null;
  ai_priority: AIPriorityTier | null;
  ai_score_updated_at: string | null;
  // Dedup fields (Phase A1+)
  normalized_email: string | null;
  merged_into: string | null;
  // IT Agency fields
  company_name: string | null;
  designation: string | null;
  prospect_industry: string | null;
  owner_id: string | null;
  salutation: string | null;
  company_email: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

// AI Insights Types
export type AIScoreLabel = "High" | "Medium" | "Low";
export type AIPriorityTier = "hot" | "warm" | "cold" | "unlikely";
export type AIActionType = "call" | "email" | "task" | "update";
export type AIFactorImpact = "positive" | "negative" | "neutral";

export interface AIScoreFactor {
  label: string;
  impact: AIFactorImpact;
  points: number;
}

export interface AIRecommendedAction {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionType: AIActionType;
}

export interface AIEngagementStats {
  totalInteractions: number;
  lastInteraction: string;
  responseRate: string;
  avgResponseTime: string;
}

export interface LeadInsights {
  id: string;
  tenant_id: string;
  lead_id: string;
  score: number;
  score_label: AIScoreLabel;
  priority_tier: AIPriorityTier;
  factors: AIScoreFactor[];
  summary: string;
  actions: AIRecommendedAction[];
  engagement: AIEngagementStats;
  generated_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

// API response type for insights endpoint
export interface LeadInsightsResponse extends LeadInsights {
  isStale: boolean;
  isExpired: boolean;
}

export interface LeadNote {
  id: string;
  lead_id: string;
  user_id: string;
  user_email: string;
  content: string;
  created_at: string;
}

export interface FormAttribution {
  default_source?: string | null;
  default_medium?: string | null;
  default_campaign?: string | null;
}

export interface UtmLink {
  id: string;
  tenant_id: string;
  form_id: string | null;
  destination_url: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  tracking_url: string;
  created_by: string | null;
  created_at: string;
  // Joined from form_configs (set by API/server when listing)
  form_name?: string | null;
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
  attribution: FormAttribution | null;
  target_pipeline_id: string | null;
  autoresponder?: {
    enabled: boolean;
    fire_mode: "every" | "first";
    subject: string;
    body_html: string;
  };
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

// Pipeline Types
export type TerminalType = "won" | "lost";

export interface Pipeline {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  position: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineWithStages extends Pipeline {
  stages: PipelineStage[];
  lead_count: number;
}

export interface PipelineWithCounts extends Pipeline {
  stage_count: number;
  lead_count: number;
}

export interface PipelineStage {
  id: string;
  tenant_id: string;
  pipeline_id: string;
  name: string;
  slug: string;
  position: number;
  color: string;
  is_default: boolean;
  is_terminal: boolean;
  terminal_type: TerminalType | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineStageWithCount extends PipelineStage {
  lead_count: number;
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

// Lead Activity Types (HubSpot-style)
export type ActivityType = "call" | "email" | "meeting";
export type CallOutcome = "connected" | "left_voicemail" | "no_answer" | "busy" | "wrong_number";

export interface LeadActivityRecord {
  id: string;
  lead_id: string;
  tenant_id: string;
  user_id: string;
  activity_type: ActivityType;
  subject: string | null;
  description: string | null;
  call_outcome: CallOutcome | null;
  duration_minutes: number | null;
  scheduled_at: string | null;
  location: string | null;
  attendees: string[] | null;
  email_subject: string | null;
  email_body: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Joined fields
  user_email?: string;
}

// ============================================================
// Time Tracking (IT-agency industry-scoped)
// ============================================================

export interface Account {
  id: string;
  tenant_id: string;
  name: string;
  primary_contact_email: string | null;
  primary_contact_id: string | null;
  notes: string | null;
  is_active: boolean;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectStatus = "planning" | "active" | "in_review" | "delivered" | "on_hold" | "cancelled";

export interface Project {
  id: string;
  tenant_id: string;
  account_id: string;
  name: string;
  status: ProjectStatus;
  default_rate: number | null;
  is_billable: boolean;
  notes: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "todo" | "in_progress" | "done";

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface Task {
  id: string;
  tenant_id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  estimated_minutes: number | null;
  is_billable: boolean;
  position: number;
  assignee_id: string | null;
  due_date: string | null;
  priority: TaskPriority;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface TimeEntry {
  id: string;
  tenant_id: string;
  user_id: string;
  task_id: string | null;
  project_id: string;
  entry_date: string;
  minutes: number;
  notes: string | null;
  is_billable: boolean;
  rate_snapshot: number | null;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// CRM Contacts (IT-agency industry-scoped)
// ============================================================

export type ContactStatus = "active" | "inactive";
export type ProjectContactRole = "primary" | "technical" | "billing" | "other";

export interface Contact {
  id: string;
  tenant_id: string;
  account_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  status: ContactStatus;
  assigned_to: string | null;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectContact {
  project_id: string;
  contact_id: string;
  role: ProjectContactRole | null;
  created_at: string;
}

export interface Position {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  base_tier: "owner" | "admin" | "member";
  is_system: boolean;
  layer_id: string | null;
  permissions: import("@/lib/api/permissions").PositionPermissions;
  created_at: string;
  updated_at: string;
}

export interface OrgLayer {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Lead Dedup — Phase A1
// ============================================================

export interface LeadSubmission {
  id: string;
  tenant_id: string;
  lead_id: string;
  form_config_id: string | null;
  session_id: string | null;
  created_via: "public_form" | "public_api" | "integration" | "manual" | "backfill";
  idempotency_key: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  normalized_email: string | null;
  normalized_phone: string | null;
  custom_fields: Record<string, unknown>;
  file_urls: Record<string, unknown>;
  intake_source: string | null;
  intake_medium: string | null;
  intake_campaign: string | null;
  entity_id: string | null;
  raw_payload: Record<string, unknown>;
  matched_existing: boolean;
  created_at: string;
}

export interface LeadMerge {
  id: string;
  tenant_id: string;
  canonical_id: string;
  absorbed_id: string;
  merged_by: string | null;
  source: "manual" | "backfill";
  repointed_counts: Record<string, unknown>;
  field_patch: Record<string, unknown>;
  created_at: string;
}

export interface LeadDuplicateSuggestion {
  id: string;
  tenant_id: string;
  lead_id: string;
  suggested_lead_id: string;
  reason: "phone" | "name";
  status: "open" | "dismissed" | "merged";
  created_at: string;
}

// ============================================================
// Deals / Opportunities (it_agency feature)
// ============================================================

export interface DealPipeline {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  position: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DealPipelineWithCounts extends DealPipeline {
  stage_count: number;
  deal_count: number;
}

export interface DealStageWithCount extends DealStage {
  deal_count: number;
}

export interface DealPipelineWithStages extends DealPipeline {
  stages: DealStageWithCount[];
  deal_count: number;
}

export interface DealStage {
  id: string;
  tenant_id: string;
  pipeline_id: string;
  name: string;
  slug: string;
  position: number;
  color: string;
  is_default: boolean;
  is_terminal: boolean;
  terminal_type: "won" | "lost" | null;
  created_at: string;
  updated_at: string;
}

export interface Deal {
  id: string;
  tenant_id: string;
  pipeline_id: string | null;
  name: string;
  account_id: string | null;
  primary_contact_id: string | null;
  stage_id: string;
  amount: number | null;
  currency: string;
  close_date: string | null;
  owner_id: string | null;
  deal_type: string | null;
  priority: "low" | "medium" | "high" | null;
  description: string | null;
  status: "open" | "won" | "lost";
  last_activity_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Joined fields (from API responses)
  accounts?: { id: string; name: string } | null;
  contacts?: { id: string; first_name: string; last_name: string } | null;
}
