// POST   /api/v1/inbox/website-chat/logo — upload the logo shown at the top of the chat window (admin only)
// DELETE /api/v1/inbox/website-chat/logo — remove it again
//
// Same switch and admin rules as the settings route. The picture is checked by what its bytes are (PNG, JPEG or
// WebP, under 1 MB), forwarded to Chatwoot and not kept in EdgeX.

import { NextRequest } from "next/server";
import { apiSuccess, apiValidationError } from "@/lib/api/response";
import { checkLogoFile } from "@/lib/inbox/website-chat/logo";
import { removeWebsiteChatLogo, uploadWebsiteChatLogo } from "@/lib/inbox/website-chat/service";
import { errorResponse, guard } from "@/lib/inbox/website-chat/route-helpers";

export async function POST(request: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("logo");
  if (!file || typeof file === "string") return apiValidationError({ logo: ["Choose an image to upload"] });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkLogoFile(bytes);
  if (!checked.ok) return apiValidationError({ logo: [checked.error] });

  try {
    return apiSuccess(await uploadWebsiteChatLogo({ db: g.db.raw(), tenantId: g.auth.tenantId, file: { bytes, type: checked.type, name: checked.name } }));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  const g = await guard();
  if (!g.ok) return g.response;
  try {
    return apiSuccess(await removeWebsiteChatLogo({ db: g.db.raw(), tenantId: g.auth.tenantId }));
  } catch (err) {
    return errorResponse(err);
  }
}
