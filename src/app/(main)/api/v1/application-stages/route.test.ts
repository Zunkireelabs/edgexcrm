import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// No database: the scoped client, the service client and the pipeline resolver are fakes.
const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const resolverMock = vi.fn();

const STAGES = [
  { id: "ca-1", pipeline_id: "pipe-ca", name: "Shortlisted", position: 1, is_default: true },
  { id: "ca-2", pipeline_id: "pipe-ca", name: "Documents Pending", position: 2, is_default: false },
  { id: "uk-1", pipeline_id: "pipe-uk", name: "Shortlisted", position: 1, is_default: true },
  { id: "uk-2", pipeline_id: "pipe-uk", name: "Documents Pending", position: 2, is_default: false },
  { id: "df-1", pipeline_id: "pipe-default", name: "Shortlisted", position: 1, is_default: true },
];
let eqCalls: [string, unknown][] = [];

vi.mock("@/lib/api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/auth")>("@/lib/api/auth");
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/applications/pipeline-resolution", () => ({ resolveApplicationPipelineAndStage: resolverMock }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => ({}) }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    from: () => {
      let filter: [string, unknown] | null = null;
      const t: Record<string, unknown> = {};
      t.select = () => t;
      t.eq = (col: string, val: unknown) => { filter = [col, val]; eqCalls.push([col, val]); return t; };
      t.order = async () => ({
        data: STAGES.filter((s) => !filter || (s as Record<string, unknown>)[filter[0]] === filter[1]),
        error: null,
      });
      return t;
    },
  }),
}));

function authAs(): AuthContext {
  return { userId: "u1", tenantId: "tenant-1", industryId: "education_consultancy", role: "admin", permissions: {} } as unknown as AuthContext;
}
function req(query = ""): NextRequest {
  return { nextUrl: new URL(`http://localhost/api/v1/application-stages${query}`) } as unknown as NextRequest;
}

beforeEach(() => {
  eqCalls = [];
  authenticateRequestMock.mockReset().mockResolvedValue(authAs());
  getFeatureAccessMock.mockReset().mockReturnValue(true);
  resolverMock.mockReset().mockResolvedValue({ ok: true, pipelineId: "pipe-ca", stageId: "ca-1" });
});

describe("GET /api/v1/application-stages", () => {
  it("without ?country returns every stage of every pipeline (unchanged behaviour)", async () => {
    const { GET } = await import("./route");
    const body = await (await GET(req())).json();

    expect(body.data).toHaveLength(STAGES.length);
    expect(resolverMock).not.toHaveBeenCalled();
  });

  it("with ?country returns ONLY that country's pipeline stages — no repeated names", async () => {
    const { GET } = await import("./route");
    const body = await (await GET(req("?country=Canada"))).json();

    expect(resolverMock).toHaveBeenCalledWith(expect.anything(), { tenantId: "tenant-1", countryName: "Canada" });
    expect(eqCalls).toContainEqual(["pipeline_id", "pipe-ca"]);
    expect(body.data.map((s: { id: string }) => s.id)).toEqual(["ca-1", "ca-2"]);
    const names = body.data.map((s: { name: string }) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("an empty country (no destination chosen yet) is passed on as empty, so the resolver falls back to the default pipeline", async () => {
    resolverMock.mockResolvedValue({ ok: true, pipelineId: "pipe-default", stageId: "df-1" });
    const { GET } = await import("./route");
    const body = await (await GET(req("?country="))).json();

    expect(resolverMock).toHaveBeenCalledWith(expect.anything(), { tenantId: "tenant-1", countryName: "" });
    expect(body.data.map((s: { id: string }) => s.id)).toEqual(["df-1"]);
  });

  it("trims the country name before resolving it", async () => {
    const { GET } = await import("./route");
    await GET(req("?country=%20Canada%20"));
    expect(resolverMock).toHaveBeenCalledWith(expect.anything(), { tenantId: "tenant-1", countryName: "Canada" });
  });

  it("falls back to the full list when no pipeline can be resolved, so the form is never left empty", async () => {
    resolverMock.mockResolvedValue({ ok: false, reason: "no_pipeline" });
    const { GET } = await import("./route");
    const body = await (await GET(req("?country=Atlantis"))).json();
    expect(body.data).toHaveLength(STAGES.length);
  });

  it("401 when not signed in", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { GET } = await import("./route");
    expect((await GET(req())).status).toBe(401);
  });

  it("403 for a tenant without Application Tracking", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    const { GET } = await import("./route");
    expect((await GET(req("?country=Canada"))).status).toBe(403);
    expect(resolverMock).not.toHaveBeenCalled();
  });
});
