import { describe, it, expect, vi, beforeEach } from "vitest";

const { gateMock, auditMock, dismissMock, getVersionMock } = vi.hoisted(() => ({ gateMock: vi.fn(), auditMock: vi.fn(), dismissMock: vi.fn(), getVersionMock: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: auditMock }));
vi.mock("@/industries/education-consultancy/features/processes/server/context", () => ({ resolveProcessesContext: gateMock }));
vi.mock("@/industries/education-consultancy/features/processes/server/changes", () => ({ dbRejectStore: () => ({ getVersion: getVersionMock }) }));
vi.mock("@/industries/education-consultancy/features/processes/server/improver/read-store", () => ({ dismissProcessRead: dismissMock }));

import { POST } from "./route";

const call = (key = "new_lead_first_call", versionId = "v2") => POST(new Request("http://x") as never, { params: Promise.resolve({ key, versionId }) });
const ctx = { auth: { tenantId: "t1", userId: "u1" }, db: {} };

beforeEach(() => {
  vi.clearAllMocks();
  gateMock.mockResolvedValue({ ok: true, ctx });
  getVersionMock.mockResolvedValue({ id: "v2", process_id: "p1", status: "live", owner_user_id: null });
  dismissMock.mockResolvedValue(true);
});

describe("POST .../versions/[versionId]/read/dismiss", () => {
  it("dismisses Orca's read and writes an audit row", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(dismissMock).toHaveBeenCalledWith(ctx.db, "v2", "u1", expect.any(Date));
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1", userId: "u1", action: "process.read_dismissed", entityType: "process_version", entityId: "v2" }));
  });
  it("the gate decides who may (owner/admin only): a refused gate returns its response and touches nothing", async () => {
    gateMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await call()).status).toBe(403);
    expect(dismissMock).not.toHaveBeenCalled();
  });
  it("a version that isn't this process's (or this tenant's) is a 404, an unknown process key too", async () => {
    getVersionMock.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect((await call("nope")).status).toBe(404);
    expect(dismissMock).not.toHaveBeenCalled();
  });
  it("nothing to dismiss (already dismissed) is a conflict, not a second audit row", async () => {
    dismissMock.mockResolvedValue(false);
    expect((await call()).status).toBe(409);
    expect(auditMock).not.toHaveBeenCalled();
  });
});
