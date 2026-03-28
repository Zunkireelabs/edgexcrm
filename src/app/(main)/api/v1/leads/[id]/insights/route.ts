import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiNotFound,
  apiInternalError,
} from "@/lib/api/response";
import { generateLeadInsights } from "@/lib/ai/scoring-engine";
import type { Lead, LeadNote, LeadInsights, LeadInsightsResponse } from "@/types/database";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/leads/[id]/insights
 * Retrieve cached insights for a lead
 * Returns cached insights if valid, null if expired/missing
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticateRequest();
    if (!auth) return apiUnauthorized();

    const { id: leadId } = await params;
    const supabase = await createServiceClient();

    // Verify lead exists and belongs to tenant
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id")
      .eq("id", leadId)
      .eq("tenant_id", auth.tenantId)
      .is("deleted_at", null)
      .single();

    if (leadError || !lead) {
      return apiNotFound("Lead");
    }

    // Get cached insights
    const { data: insights } = await supabase
      .from("lead_insights")
      .select("*")
      .eq("lead_id", leadId)
      .eq("tenant_id", auth.tenantId)
      .single();

    if (!insights) {
      return apiSuccess({ insights: null, cached: false });
    }

    // Check if expired
    const now = new Date();
    const expiresAt = new Date(insights.expires_at);
    const generatedAt = new Date(insights.generated_at);
    const isExpired = now > expiresAt;
    const isStale = now.getTime() - generatedAt.getTime() > 12 * 60 * 60 * 1000; // 12 hours

    const response: LeadInsightsResponse = {
      ...insights,
      isStale,
      isExpired,
    };

    return apiSuccess({ insights: response, cached: true });
  } catch (error) {
    console.error("Get insights error:", error);
    return apiInternalError();
  }
}

/**
 * POST /api/v1/leads/[id]/insights
 * Generate or refresh insights for a lead
 * Query params:
 *   - force=true: Force regeneration even if cached
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const auth = await authenticateRequest();
    if (!auth) return apiUnauthorized();

    const { id: leadId } = await params;
    const { searchParams } = new URL(request.url);
    const forceRegenerate = searchParams.get("force") === "true";

    const supabase = await createServiceClient();

    // Get lead with full data
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("tenant_id", auth.tenantId)
      .is("deleted_at", null)
      .single();

    if (leadError || !lead) {
      return apiNotFound("Lead");
    }

    // Check for valid cached insights (unless force regenerate)
    if (!forceRegenerate) {
      const { data: cached } = await supabase
        .from("lead_insights")
        .select("*")
        .eq("lead_id", leadId)
        .eq("tenant_id", auth.tenantId)
        .single();

      if (cached) {
        const now = new Date();
        const expiresAt = new Date(cached.expires_at);

        if (now < expiresAt) {
          // Return cached insights
          const response: LeadInsightsResponse = {
            ...cached,
            isStale: false,
            isExpired: false,
          };
          return apiSuccess({ insights: response, cached: true, regenerated: false });
        }
      }
    }

    // Get notes for engagement calculation
    const { data: notes } = await supabase
      .from("lead_notes")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });

    // Generate new insights
    const insightsData = generateLeadInsights(
      lead as Lead,
      (notes || []) as LeadNote[],
      auth.tenantId
    );

    // Upsert insights (insert or update)
    const { data: savedInsights, error: upsertError } = await supabase
      .from("lead_insights")
      .upsert(
        {
          ...insightsData,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "lead_id",
        }
      )
      .select()
      .single();

    if (upsertError) {
      console.error("Failed to save insights:", upsertError);
      return apiInternalError();
    }

    // Update lead's ai_score and ai_priority for quick filtering
    await supabase
      .from("leads")
      .update({
        ai_score: insightsData.score,
        ai_priority: insightsData.priority_tier,
        ai_score_updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .eq("tenant_id", auth.tenantId);

    const response: LeadInsightsResponse = {
      ...(savedInsights as LeadInsights),
      isStale: false,
      isExpired: false,
    };

    return apiSuccess({ insights: response, cached: false, regenerated: true });
  } catch (error) {
    console.error("Generate insights error:", error);
    return apiInternalError();
  }
}
