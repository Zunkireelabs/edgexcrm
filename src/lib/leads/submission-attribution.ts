// Decides how a lead created through POST /api/v1/leads is attributed on its
// "Lead created" timeline entry and in lead_submissions.created_via.
//
// The public form widget and the dashboard's own create flows (Add Lead,
// Check-in, Inbox "convert to lead") all hit this one route. The widget always
// sends form_config_id; the dashboard flows never do. A logged-in staff member
// previewing a public form still sends form_config_id, so a session alone is
// not enough to call a request "manual".

export interface SubmissionAttribution {
  createdVia: "public_form" | "manual";
  // The staff member to record as the actor on the audit entry; null for
  // anonymous form submissions.
  actorUserId: string | null;
}

export function resolveSubmissionAttribution(input: {
  dashboardUserId: string | null | undefined;
  formConfigId: unknown;
}): SubmissionAttribution {
  const isStaffCreate = Boolean(input.dashboardUserId) && !input.formConfigId;
  return isStaffCreate
    ? { createdVia: "manual", actorUserId: input.dashboardUserId ?? null }
    : { createdVia: "public_form", actorUserId: null };
}
