// GET /api/v1/inbox/handover-targets
// The people a website chat can be handed to: team members whose position lets them open the Inbox.
// Feeds the "Hand over" picker, so nobody is ever offered someone who couldn't see the chat.

import { authenticateRequest } from "@/lib/api/auth";
import { canSeeNav } from "@/lib/api/permissions";
import { apiUnauthorized, apiForbidden, apiSuccess } from "@/lib/api/response";
import { createServiceClient } from "@/lib/supabase/server";
import { inboxMemberDirectory } from "@/lib/inbox/claim";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!canSeeNav(auth.permissions, "/inbox")) return apiForbidden();

  const supabase = await createServiceClient();
  const members = await inboxMemberDirectory(supabase, auth.tenantId);
  return apiSuccess(members);
}
