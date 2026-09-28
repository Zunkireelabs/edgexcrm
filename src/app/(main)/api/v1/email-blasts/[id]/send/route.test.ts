import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// This route used to do the audience re-resolution, recipient-cap check, and
// row materialization itself, synchronously, before ever handing off to the
// background worker — that work now lives entirely in
// materializeBlastAudience (src/lib/email/outbound/blast-runner.ts), driven
// via Next's after() rather than an Inngest event handoff (moved off Inngest
// 2026-09-28 — see docs/SESSION-LOG.md). What's left here is deliberately
// thin: validate the blast is a sendable draft, reject a sender with a
// restricted lead-visibility scope (the one check that stays synchronous —
// see the route's own comment for why), flip the status, and schedule the
// background send. The materialization/cap/chunking test coverage that used
// to live in this file now lives in blast-runner.test.ts, against
// materializeBlastAudience directly.

const requireEmailCampaignsAccessMock = vi.fn();
const processOneBlastMock = vi.fn();
const afterMock = vi.fn();

vi.mock("@/lib/email/outbound/api-guard", () => ({ requireEmailCampaignsAccess: requireEmailCampaignsAccessMock }));
vi.mock("@/lib/email/outbound/blast-runner", () => ({ processOneBlast: processOneBlastMock }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: afterMock };
});

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
              // Second .eq() is the .eq("status","draft") precondition
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
    processOneBlastMock.mockReset();
    processOneBlastMock.mockResolvedValue({ blastId: "blast-1" });
    afterMock.mockReset();
  });

  it("flips status to queued, then schedules the background send via after() — never touches audience/materialization itself", async () => {
    const fake = fakeDb();
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    const body = (await res.json()) as { data: { blast: { status: string } } };

    expect(res.status).toBe(200);
    expect(body.data.blast.status).toBe("queued");
    expect(afterMock).toHaveBeenCalledTimes(1);

    // Run the scheduled callback and confirm it drives the actual background
    // send with the click-time sender identity.
    const scheduled = afterMock.mock.calls[0][0] as () => void;
    scheduled();
    expect(processOneBlastMock).toHaveBeenCalledWith("tenant-1", "blast-1", "user-1");
  });

  it("rejects sending a non-draft blast, and never schedules a background send", async () => {
    const fake = fakeDb({ blastStatus: "queued" });
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });

    expect(res.status).toBe(409);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("rejects empty subject/body before flipping status", async () => {
    const fake = fakeDb();
    fake.blastRow.subject_template = "";
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });

    expect(res.status).toBe(422);
    expect(afterMock).not.toHaveBeenCalled();
  });

  // The one check that intentionally stays synchronous — see the route's own
  // header comment: a background job has no way to safely resolve an
  // own/branch-restricted sender's audience (the RLS RPC it needs fails
  // closed under a service-role client), so this rejects instantly rather
  // than risk the background worker silently resolving "0 recipients".
  it("rejects a sender with a restricted (own/branch) lead-visibility scope before flipping status", async () => {
    const fake = fakeDb();
    const restrictedAuth = { ...AUTH, permissions: RESTRICTED_PERMISSIONS } as AuthContext;
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: restrictedAuth, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    const json = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("RESTRICTED_SENDER_SCOPE");
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("an unrestricted (all-leads) sender is unaffected by the scope check", async () => {
    const fake = fakeDb();
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });

    expect(res.status).toBe(200);
    expect(afterMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a log-correlatable error and never schedules a background send if the status update itself fails", async () => {
    const fake = fakeDb({ updateFails: true });
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    const json = (await res.json()) as { error: { message: string } };

    expect(res.status).toBe(503);
    expect(json.error.message).toMatch(/ref: [0-9a-f-]{36}/);
    // Unlike the old Inngest-event-first ordering, this request does its own
    // status write first — if that write itself errors, there is nothing to
    // hand off to the background at all.
    expect(afterMock).not.toHaveBeenCalled();
  });
});
