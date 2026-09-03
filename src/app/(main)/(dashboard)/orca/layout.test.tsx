import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUserTenantMock = vi.fn();
const isAssistantEnabledMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const redirectMock = vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
});

vi.mock("next/navigation", () => ({ notFound: notFoundMock, redirect: redirectMock }));
vi.mock("@/lib/supabase/queries", () => ({ getCurrentUserTenant: getCurrentUserTenantMock }));
vi.mock("@/lib/ai/flag", () => ({
  isAssistantEnabled: isAssistantEnabledMock,
  requireOrcaAccess: (role?: string) => role === "owner",
}));

function tenant(role: string) {
  return { tenant: { id: "t1", ai_enabled: true }, role };
}

describe("OrcaLayout — interim access gate", () => {
  beforeEach(() => {
    notFoundMock.mockClear();
    redirectMock.mockClear();
    isAssistantEnabledMock.mockReturnValue(true);
  });

  it("renders children for an owner", async () => {
    getCurrentUserTenantMock.mockResolvedValue(tenant("owner"));
    const { default: OrcaLayout } = await import("./layout");
    const out = await OrcaLayout({ children: "kids" as never });
    expect(out).toBe("kids");
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it.each(["admin", "counselor", "viewer"])("404s for a %s (owner-only)", async (role) => {
    getCurrentUserTenantMock.mockResolvedValue(tenant(role));
    const { default: OrcaLayout } = await import("./layout");
    await expect(OrcaLayout({ children: "kids" as never })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("404s when the tenant lacks the AI grant even for an owner", async () => {
    getCurrentUserTenantMock.mockResolvedValue({ tenant: { id: "t1", ai_enabled: false }, role: "owner" });
    const { default: OrcaLayout } = await import("./layout");
    await expect(OrcaLayout({ children: "kids" as never })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
