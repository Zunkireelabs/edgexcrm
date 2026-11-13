import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { createFakeSupabase } from "@/industries/education-consultancy/features/application-tracking/lib/__test__/fake-postgrest";
import { APPS, AUTH, ME, T, inBranch, leadOwner, meCanSee } from "@/industries/education-consultancy/features/application-tracking/lib/__test__/applications-api-seed";

// EDGEX-141 Phase 3, B1 audit: a SINGLE application (GET /applications/[id] and its notes) enforces
// the caller's scope through getApplicationWithAccess (the lead-access rule): an application outside
// a counsellor's / branch manager's scope is a 404, never the record.

const state = vi.hoisted(() => ({ auth: null as unknown, db: null as unknown }));
vi.mock("@/lib/api/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/api/auth")>();
  return { ...real, authenticateRequest: async () => state.auth };
});
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => state.db, createClient: async () => state.db }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: async () => state.db }));

import { GET } from "./route";
import { GET as GET_NOTES } from "./notes/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost/x") as unknown as NextRequest;

beforeEach(() => {
  state.db = createFakeSupabase({
    applications: APPS as never,
    leads: APPS.map((a, i) => ({ id: a.lead_id, tenant_id: T, assigned_to: leadOwner(i), branch_id: null, deleted_at: null })),
    lead_collaborators: APPS.flatMap((a, i) => (i % 50 === 2 ? [{ tenant_id: T, lead_id: a.lead_id, user_id: ME }] : [])),
    lead_branches: [],
    application_notes: [],
  });
});

const outsideMe = APPS.findIndex((_, i) => !meCanSee(i) && !inBranch(i));
const collab = 2; // assigned to someone else; ME is a collaborator
const own = APPS.findIndex((_, i) => leadOwner(i) === ME);

describe("single application scope", () => {
  it("counsellor: 404 on an application outside their scope (detail and notes)", async () => {
    state.auth = AUTH.counsellor;
    expect((await GET(req(), params(APPS[outsideMe].id))).status).toBe(404);
    expect((await GET_NOTES(req(), params(APPS[outsideMe].id))).status).toBe(404);
  });

  it("counsellor: 200 on their own lead's application and on a collaborator lead's (read)", async () => {
    state.auth = AUTH.counsellor;
    expect((await GET(req(), params(APPS[own].id))).status).toBe(200);
    expect((await GET(req(), params(APPS[collab].id))).status).toBe(200);
  });

  it("branch manager: 200 inside the branch, 404 outside it", async () => {
    state.auth = AUTH.manager;
    const inside = APPS.findIndex((_, i) => inBranch(i));
    expect((await GET(req(), params(APPS[inside].id))).status).toBe(200);
    expect((await GET(req(), params(APPS[outsideMe].id))).status).toBe(404);
  });
});
