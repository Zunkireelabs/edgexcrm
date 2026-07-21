import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { skipDraft } from "@/industries/_shared/features/outreach/lib/engine";

type Props = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: draft } = await db.from("sequence_step_drafts").select("assigned_to").eq("id", id).maybeSingle();
  if (!draft) return apiNotFound("Draft");
  const draftRow = draft as unknown as { assigned_to: string | null };
  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier && draftRow.assigned_to !== auth.userId) return apiForbidden();

  const ok = await skipDraft(db, auth, id);
  if (!ok) return apiNotFound("Draft");

  return apiSuccess({ id, status: "skipped" });
}
