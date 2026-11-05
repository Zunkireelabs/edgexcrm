import { describe, it, expect, vi, beforeEach } from "vitest";

// The page shell is the first of three gates (sidebar / page / API). Other industries and non-owner/admin roles
// must get notFound() — never the UI.

const tenant = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/supabase/queries", () => ({ getCurrentUserTenant: vi.fn(async () => tenant.current) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (k === "edgex_branch" ? { value: "branch-1" } : undefined) }) }));
vi.mock("@/industries/education-consultancy/features/pulse/ui/pulse-page", () => ({ PulsePage: () => null }));

class NotFound extends Error {}
class Redirect extends Error {
  constructor(public to: string) { super(to); }
}
vi.mock("next/navigation", () => ({
  notFound: () => { throw new NotFound(); },
  redirect: (to: string) => { throw new Redirect(to); },
}));

import Page from "./page";

const mk = (industry: string, role: string) => ({ tenant: { industry_id: industry }, role });

beforeEach(() => { tenant.current = mk("education_consultancy", "owner"); });

describe("/pulse page shell", () => {
  it("redirects an anonymous visitor to /login", async () => {
    tenant.current = null;
    await expect(Page()).rejects.toMatchObject({ to: "/login" });
  });
  it.each(["it_agency", "travel_agency", "construction", "general", "real_estate"])("notFound() for %s", async (industry) => {
    tenant.current = mk(industry, "owner");
    await expect(Page()).rejects.toBeInstanceOf(NotFound);
  });
  it.each(["staff", "viewer", "counselor"])("notFound() for an education %s", async (role) => {
    tenant.current = mk("education_consultancy", role);
    await expect(Page()).rejects.toBeInstanceOf(NotFound);
  });
  it.each(["owner", "admin"])("renders for an education %s, keyed by the branch cookie", async (role) => {
    tenant.current = mk("education_consultancy", role);
    const el = (await Page()) as { key: string };
    expect(el.key).toBe("branch-1");
  });
});
