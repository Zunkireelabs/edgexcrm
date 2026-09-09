import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// This route used to do the audience re-resolution, recipient-cap check, and
// row materialization itself, synchronously, before ever handing off to the
// background worker — that work now lives entirely in
// materializeBlastAudience (src/lib/inngest/functions/email-blast-send.ts),
// moved there specifically so a client that disconnects right after clicking
// Send can never interrupt it (see that file's own header comment). What's
// left here is deliberately thin: validate the blast is a sendable draft,
// reject a sender with a restricted lead-visibility scope (the one check that
// stays synchronous — see the route's own comment for why), hand off to
// Inngest, and flip the status. The materialization/cap/chunking test
// coverage that used to live in this file now lives in
// email-blast-send.test.ts, against materializeBlastAudience directly.

const requireEmailCampaignsAccessMock = vi.fn();
const inngestSendMock = vi.fn();

vi.mock("@/lib/email/outbound/api-guard", () => ({ requireEmailCampaignsAccess: requireEmailCampaignsAccessMock }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: inngestSendMock } }));

const UNRESTRICTED_PERMISSIONS = { leadScope: "all", pipelineAccess: "all" } as unknown as AuthContext["permissions"];
const RESTRICTED_PERMISSIONS = { leadScope: "own", pipelineAccess: "all" } as unknown as AuthContext["permissions"];

const AUTH = {
  userId: "user-1",
  tenantId: "tenant-1",
  role: "owner",
  industryId: "education_consultancy",
  positionSlug: null,
  branchId: null,
  permissions: UNRESTRICTED_PERMISSIONS,
} as unknown as AuthContext;

const params = Promise.resolve({ id: "blast-1" });

function fakeReq(): NextRequest {
  return {} as unknown as NextRequest;
}

function fakeDb(opts: { blastStatus?: string; updateFails?: boolean } = {}) {
  const blastRow = {
    id: "blast-1",
    subject_template: "Hi {{first_name}}",
    body_template: "<p>Hi {{first_name}}</p>",
    status: opts.blastStatus ?? "draft",
  };

  const db = {
    from(table: string) {
      if (table === "email_blasts") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...blastRow }, error: null }) }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              // Second .eq() is the new .eq("status","draft") precondition
              // (route.ts) — models a real PostgREST update: it only applies
              // the patch (and only matches a row) when blastRow.status
              // equals the value being filtered on.
              eq: (_col: string, val: string) => ({
                select: () => ({
                  maybeSingle: () => {
                    if (opts.updateFails) return Promise.resolve({ data: null, error: { message: "connection reset" } });
                    if (blastRow.status !== val) return Promise.resolve({ data: null, error: null });
                    Object.assign(blastRow, patch);
                    return Promise.resolve({ data: { ...blastRow }, error: null });
                  },
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { db, blastRow };
}

describe("POST /api/v1/email-blasts/[id]/send", () => {
  beforeEach(() => {
    requireEmailCampaignsAccessMock.mockReset();
    inngestSendMock.mockReset();
  });

  it("hands off to Inngest BEFORE flipping the status, and never touches audience/materialization itself", async () => {
    const fake = fakeDb();
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    const body = (await res.json()) as { data: { blast: { status: string } } };

    expect(res.status).toBe(200);
    expect(inngestSendMock).toHaveBeenCalledWith({
      name: "email/blast.send",
      data: { tenantId: "tenant-1", blastId: "blast-1", senderId: "user-1" },
    });
    expect(body.data.blast.status).toBe("queued");
    // Confirms the response returns almost immediately — no audience
    // resolution, cap check, or row-write call is made from this route at all.
  });

  it("rejects sending a non-draft blast, and never hands off to Inngest", async () => {
    const fake = fakeDb({ blastStatus: "queued" });
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });

    expect(res.status).toBe(409);
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("rejects empty subject/body before handing off", async () => {
    const fake = fakeDb();
    fake.blastRow.subject_template = "";
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });

    expect(res.status).toBe(422);
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  // The one check that intentionally stays synchronous — see the route's own
  // header comment: a background job has no way to safely resolve an
  // own/branch-restricted sender's audience (the RLS RPC it needs fails
  // closed under a service-role client), so this rejects instantly rather
  // than risk the background worker silently resolving "0 recipients".
  it("rejects a sender with a restricted (own/branch) lead-visibility scope before handing off", async () => {
    const fake = fakeDb();
    const restrictedAuth = { ...AUTH, permissions: RESTRICTED_PERMISSIONS } as AuthContext;
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: restrictedAuth, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    const json = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("RESTRICTED_SENDER_SCOPE");
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("an unrestricted (all-leads) sender is unaffected by the scope check", async () => {
    const fake = fakeDb();
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });

    expect(res.status).toBe(200);
    expect(inngestSendMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a log-correlatable error if the post-handoff status update fails", async () => {
    const fake = fakeDb({ updateFails: true });
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    const json = (await res.json()) as { error: { message: string } };

    expect(res.status).toBe(503);
    expect(json.error.message).toMatch(/ref: [0-9a-f-]{36}/);
    // The event was still sent — the background worker will pick this blast
    // up even though the client sees an error here (see the route's ordering
    // comment: emit-then-update, not update-then-emit).
    expect(inngestSendMock).toHaveBeenCalledTimes(1);
  });

  // Race regression: there's no atomicity between inngest.send() and this
  // route's own status update, so the worker can start (and even finish)
  // before this update runs. Simulates the worker racing all the way ahead
  // and advancing the blast past 'draft' inside the inngest.send() call
  // itself, standing in for "by the time this request's update fires, the
  // worker already got there first."
  it("returns success without clobbering a blast the worker already advanced past 'draft'", async () => {
    const fake = fakeDb();
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    inngestSendMock.mockImplementation(() => {
      fake.blastRow.status = "sending"; // the worker won the race
      return Promise.resolve();
    });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    const body = (await res.json()) as { data: { blast: { status: string } } };

    expect(res.status).toBe(200);
    // Not reset back to 'queued' — the worker's advanced state is preserved.
    expect(body.data.blast.status).toBe("sending");
  });
});
