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
  plan: string;
  entitlement_overrides: Record<string, unknown>;
  timezone: string;
  weekend_days: number[];
  default_currency: string;
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
  cost_rate: number | null;
  branch_id: string | null;
  created_at: string;
}

export interface Branch {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  manager_user_id: string | null;
  sort_order: number;
  created_at: string;
}

export interface LeadBranch {
  id: string;
  tenant_id: string;
  lead_id: string;
  branch_id: string;
  assigned_to: string | null;
  is_origin: boolean;
  shared_by: string | null;
  shared_at: string;
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
  ref_code: string | null;
  form_source: string | null;
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
  branch_id: string | null;
  // Lead Lists fields (education_consultancy — migration 059)
  list_id: string | null;
  destinations: string[];
  field_of_study: string | null;
  degree_level: string | null;
  // Nationality + intake page/account (migration 087)
  nationality: string | null;
  intake_account: string | null;
  // Pre-Application fee (education_consultancy — migration 084)
  pre_app_fee_status: "paid" | "unpaid" | "waiver" | null;
  pre_app_fee_amount: number | null;
  pre_app_fee_notes: string | null;
  // Academic qualification + test scores (education_consultancy — migration 159)
  see_gpa: string | null;
  see_institution: string | null;
  see_passed_year: number | null;
  plus_two_gpa: string | null;
  plus_two_institution: string | null;
  plus_two_passed_year: number | null;
  bachelor_gpa: string | null;
  bachelor_institution: string | null;
  bachelor_passed_year: number | null;
  masters_gpa: string | null;
  masters_institution: string | null;
  masters_passed_year: number | null;
  ielts_score: string | null;
  pte_score: string | null;
  toefl_score: string | null;
  sat_score: string | null;
  gre_gmat_score: string | null;
  archive_reason: string | null;
  archived_by: string | null;
  archived_at: string | null;
  archived_from_list_id: string | null;
  archived_from_status: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
}

export interface LeadList {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_system: boolean;
  is_archive: boolean;
  is_intake: boolean;
  is_staging?: boolean;
  color: string | null;
  access: { mode: "all" } | { mode: "allow"; positionIds: string[] };
  pipeline_id: string | null;
  /** Groups this list under a sidebar funnel (it_agency only). Null = ungrouped. */
  funnel_key: string | null;
  created_at: string;
  updated_at: string;
  count?: number;
}

export interface LeadImportSource {
  id: string;
  tenant_id: string;
  staging_list_id: string;
  source_label: string;
  raw_rows: number;
  dropped_rows: number;
  no_contact_rows: number;
  with_contact_rows: number;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ImportSourceReconciliationRow {
  source_label: string;
  raw_rows: number;
  dropped_rows: number;
  no_contact_rows: number;
  with_contact_rows: number;
  notes: string | null;
  sort_order: number;
  in_crm: number;
  still_in_staging: number;
  routed_out: number;
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
  edited_at: string | null;
}

export interface FormAttribution {
  default_source?: string | null;
  default_medium?: string | null;
  default_campaign?: string | null;
  // Optional list-routing: send this form's new leads into a specific lead list
  // (a separate bucket) instead of the tenant's default intake list.
  target_list_id?: string | null;
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
  /** Non-null when this pipeline is owned by a specific lead list. */
  list_id: string | null;
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
  remind_at: string | null;
  reminded_at: string | null;
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

export interface Service {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  hours: number | null;
  price: number | null;
  billing_type: "fixed" | "hourly" | "retainer";
  category: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ProjectStatus = "planning" | "active" | "in_review" | "delivered" | "on_hold" | "cancelled";

export type EngagementModel = "fixed_bid" | "time_materials" | "retainer" | "staff_aug";

export type ProjectHealth = "green" | "amber" | "red";

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
  deal_id: string | null;
  created_at: string;
  updated_at: string;
  // Delivery Workflow Phase 1 — Brief/Qualify/Control (mig 128)
  brief: string | null;
  engagement_model: EngagementModel | null;
  definition_of_done: string | null;
  baseline_estimate_minutes: number | null;
  current_estimate_minutes: number | null;
  budget_amount: number | null;
  start_date: string | null;
  target_end_date: string | null;
  health_override: ProjectHealth | null;
  health_note: string | null;
  qualified_at: string | null;
  qualified_by: string | null;
  // Deal/Proposal -> Project handoff (mig 134)
  currency: string | null;
  // Derived, only present on GET responses that compute them
  pct_complete?: number;
  health?: ProjectHealth;
  actual_minutes?: number;
}

export type ProjectEventType =
  | "brief_captured"
  | "baseline_seeded_from_proposal"
  | "scope_baseline_set"
  | "plan_committed"
  | "change_request_proposed"
  | "change_request_approved"
  | "change_request_rejected"
  | "task_reconciled"
  | "milestone_accepted"
  | "milestone_rejected"
  | "milestone_submitted"
  | "milestone_started"
  | "issue_raised"
  | "issue_resolved"
  | "status_published"
  | "retro_lesson"
  | "invoice_generated"
  | "invoice_sent"
  | "invoice_paid"
  | "invoice_voided"
  | "risk_raised"
  | "risk_closed"
  | "risk_occurred"
  | string;

export interface ProjectEvent {
  id: string;
  tenant_id: string;
  project_id: string;
  event_type: ProjectEventType;
  actor_id: string | null;
  summary: string | null;
  payload: Record<string, unknown>;
  subject_type: string | null;
  subject_id: string | null;
  occurred_at: string;
  created_at: string;
}

export type MilestoneStatus = "pending" | "in_progress" | "submitted" | "accepted" | "rejected";

export interface ProjectMilestone {
  id: string;
  tenant_id: string;
  project_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  sort_order: number;
  amount: number | null;
  status: MilestoneStatus;
  accepted_at: string | null;
  accepted_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  // Invoicing spine (mig 133) — stamped when a generated invoice captures this milestone.
  invoiced_at: string | null;
}

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export interface Invoice {
  id: string;
  tenant_id: string;
  project_id: string;
  account_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  issue_date: string | null;
  due_date: string | null;
  notes: string | null;
  sent_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // joined (from API)
  line_items?: InvoiceLineItem[];
  projects?: { id: string; name: string } | null;
}

export interface InvoiceLineItem {
  id: string;
  tenant_id: string;
  invoice_id: string;
  milestone_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  sort_order: number;
  created_at: string;
}

export type IssueKind = "query" | "issue" | "blocker";
export type IssueSeverity = "low" | "medium" | "high";
export type IssueStatus = "open" | "in_progress" | "resolved" | "closed";
export type IssueSource = "internal" | "client";

export interface ProjectIssue {
  id: string;
  tenant_id: string;
  project_id: string;
  title: string;
  description: string | null;
  kind: IssueKind;
  severity: IssueSeverity;
  status: IssueStatus;
  source: IssueSource;
  raised_by_label: string | null;
  raised_by_contact_id: string | null;
  assigned_to: string | null;
  opened_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export type RiskLevel = "low" | "medium" | "high";
export type RiskStatus = "open" | "mitigating" | "closed" | "occurred";

export interface ProjectRisk {
  id: string;
  tenant_id: string;
  project_id: string;
  title: string;
  description: string | null;
  probability: RiskLevel;
  impact: RiskLevel;
  mitigation: string | null;
  owner_id: string | null;
  status: RiskStatus;
  review_date: string | null;
  opened_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ChangeRequestClassification = "in_scope" | "new_scope";
export type ChangeRequestStatus = "proposed" | "approved" | "rejected";

export interface ProjectChangeRequest {
  id: string;
  tenant_id: string;
  project_id: string;
  title: string;
  description: string | null;
  classification: ChangeRequestClassification;
  estimate_delta_minutes: number;
  budget_delta_amount: number | null;
  status: ChangeRequestStatus;
  client_approved: boolean;
  origin_issue_id: string | null;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectStatusReport {
  id: string;
  tenant_id: string;
  project_id: string;
  report_date: string;
  period_start: string | null;
  period_end: string | null;
  health_snapshot: ProjectHealth | null;
  summary: string | null;
  accomplishments: string | null;
  in_progress: string | null;
  risks: string | null;
  asks: string | null;
  client_message: string | null;
  pct_complete_snapshot: number | null;
  hours_actual_snapshot: number | null;
  hours_estimate_snapshot: number | null;
  is_client_visible: boolean;
  public_token: string | null;
  published_at: string | null;
  published_by: string | null;
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
  assigned_by_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
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
  cost_rate_snapshot: number | null;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  source: "manual" | "timer";
  created_at: string;
  updated_at: string;
}

export interface ActiveTimer {
  id: string;
  tenant_id: string;
  user_id: string;
  task_id: string;
  project_id: string;
  started_at: string;
  created_at: string;
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

export type DealContactRole = "primary" | "technical" | "billing" | "other";

export interface DealContact {
  deal_id: string;
  contact_id: string;
  role: DealContactRole | null;
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
// Application Tracking (education_consultancy feature)
// ============================================================

export interface ApplicationStage {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  position: number;
  color: string;
  is_default: boolean;
  terminal_type: "won" | "lost" | null;
  created_at: string;
  updated_at: string;
}

export interface Application {
  id: string;
  tenant_id: string;
  lead_id: string;
  assigned_to: string | null;
  created_by: string | null;
  university_name: string;
  program_name: string;
  intake_term: string | null;
  country: string | null;
  stage_id: string;
  status: string;
  offer_type: "conditional" | "unconditional" | null;
  application_deadline: string | null;
  application_fee_paid: boolean;
  tuition_fee: number | null;
  deposit_paid: boolean;
  offer_letter_url: string | null;
  notes: string | null;
  agent_id: string | null;
  applied_date: string | null;
  intake_start_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Joined fields (present when fetched with select joins)
  leads?: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null;
  application_stages?: ApplicationStage | null;
}

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
  probability: number;
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
  probability: number | null;
  last_activity_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // Joined fields (from API responses)
  accounts?: { id: string; name: string } | null;
  contacts?: { id: string; first_name: string; last_name: string } | null;
  projects?: { id: string; name: string }[];
}

export interface Proposal {
  id: string;
  tenant_id: string;
  deal_id: string;
  proposal_number: string;
  title: string;
  status: "draft" | "sent" | "accepted" | "rejected" | "expired";
  currency: string;
  subtotal: number;
  discount_type: "percent" | "amount" | null;
  discount_value: number;
  tax_percent: number;
  total: number;
  notes: string | null;
  valid_until: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  public_token: string | null;
  public_enabled: boolean;
  // Deal/Proposal -> Project handoff (mig 134) — set once this proposal seeds a project.
  project_id: string | null;
  // joined (from API)
  deals?: { id: string; name: string; currency: string } | null;
  line_items?: ProposalLineItem[];
}

export interface ProposalLineItem {
  id: string;
  tenant_id: string;
  proposal_id: string;
  service_id: string | null;
  name: string;
  description: string | null;
  billing_type: string | null;
  quantity: number;
  unit_price: number;
  hours: number | null;
  line_total: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Dashboard {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  widgets: string[];               // widget keys, ordered
  granted_position_ids: string[];  // position ids
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
