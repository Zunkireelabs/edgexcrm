import { createServiceClient } from "@/lib/supabase/server";
import { apiSuccess, apiInternalError } from "@/lib/api/response";
import type { Industry } from "@/types/database";

/**
 * GET /api/v1/industries
 * List all available industries (public endpoint)
 */
export async function GET() {
  try {
    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("industries")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.error("Failed to fetch industries:", error);
      return apiInternalError();
    }

    return apiSuccess(data as Industry[]);
  } catch (error) {
    console.error("Industries API error:", error);
    return apiInternalError();
  }
}
