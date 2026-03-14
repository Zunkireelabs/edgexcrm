import { NextRequest } from "next/server";
import { gateIntegrationRequest, withIntegrationErrorBoundary } from "@/lib/api/integration-helpers";
import { apiSuccess } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/integration-permissions";

const TOOL_MANIFEST = {
  name: "Zunkiree CRM",
  version: "1.0",
  tools: [
    {
      name: "list_leads",
      description: "List CRM leads with optional filtering",
      method: "GET",
      endpoint: "/api/v1/integrations/crm/leads",
      parameters: {
        stage_id: "uuid (optional)",
        assigned_to: "uuid (optional)",
        email: "string (optional, case-insensitive exact match)",
        search: "string (optional)",
        limit: "number (optional, default 50, max 100)",
        offset: "number (optional, default 0)",
      },
    },
    {
      name: "get_lead",
      description: "Get a single lead by ID with checklist summary",
      method: "GET",
      endpoint: "/api/v1/integrations/crm/leads/:id",
      parameters: {
        id: "uuid (required, path parameter)",
      },
    },
    {
      name: "create_lead",
      description: "Create a new lead",
      method: "POST",
      endpoint: "/api/v1/integrations/crm/leads",
      parameters: {
        first_name: "string (required)",
        email: "string (required)",
        last_name: "string (optional)",
        phone: "string (optional)",
        city: "string (optional)",
        country: "string (optional)",
        stage_id: "uuid (optional, defaults to tenant default stage)",
        status: "string (optional, pipeline stage slug)",
        custom_fields: "object (optional)",
        intake_source: "string (optional)",
        intake_medium: "string (optional)",
        intake_campaign: "string (optional)",
        preferred_contact_method: "string (optional)",
      },
    },
    {
      name: "update_lead",
      description: "Update lead fields. Supports dual-mode: provide status (slug) OR stage_id, not both.",
      method: "PATCH",
      endpoint: "/api/v1/integrations/crm/leads/:id",
      parameters: {
        first_name: "string (optional)",
        last_name: "string (optional)",
        email: "string (optional)",
        phone: "string (optional)",
        city: "string (optional)",
        country: "string (optional)",
        stage_id: "uuid (optional, cannot combine with status)",
        status: "string (optional, pipeline stage slug, cannot combine with stage_id)",
        assigned_to: "uuid (optional, must be tenant member)",
        custom_fields: "object (optional)",
        file_urls: "object (optional)",
        intake_source: "string (optional)",
        intake_medium: "string (optional)",
        intake_campaign: "string (optional)",
        preferred_contact_method: "string (optional)",
      },
    },
    {
      name: "assign_lead",
      description: "Assign a lead to a team member",
      method: "POST",
      endpoint: "/api/v1/integrations/crm/leads/:id/assign",
      parameters: {
        user_id: "uuid (required, must be tenant member)",
      },
    },
    {
      name: "move_stage",
      description: "Move a lead to another pipeline stage. Cannot move from terminal stages.",
      method: "POST",
      endpoint: "/api/v1/integrations/crm/leads/:id/move-stage",
      parameters: {
        stage_id: "uuid (required, must belong to tenant)",
      },
    },
    {
      name: "get_lead_checklists",
      description: "Get checklist items for a lead",
      method: "GET",
      endpoint: "/api/v1/integrations/crm/leads/:id/checklists",
      parameters: {
        id: "uuid (required, path parameter)",
      },
    },
    {
      name: "list_stages",
      description: "List all pipeline stages ordered by position",
      method: "GET",
      endpoint: "/api/v1/integrations/crm/stages",
      parameters: {},
    },
    {
      name: "get_pipeline",
      description: "Get grouped pipeline view with stages and their leads",
      method: "GET",
      endpoint: "/api/v1/integrations/crm/pipeline",
      parameters: {},
    },
  ],
};

// GET /api/v1/integrations/crm/tools
export const GET = withIntegrationErrorBoundary(async function GET(request: NextRequest) {
  const gate = await gateIntegrationRequest(request);
  if (!gate.ok) return gate.response;

  const denied = requirePermission(gate.ctx.auth, "read");
  if (denied) return denied;

  return apiSuccess(TOOL_MANIFEST);
});
