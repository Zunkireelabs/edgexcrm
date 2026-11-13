import { describe, it, expect, vi, beforeEach } from "vitest";

// The page shells are the first of three gates (sidebar / page / API). Other industries and non-owner/admin roles get notFound().
const tenant = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/lib/supabase/queries", () => ({ getCurrentUserTenant: vi.fn(async () => tenant.current) }));
vi.mock("@/industries/education-consultancy/features/processes/ui/processes-page", () => ({ ProcessesPage: () => null }));
vi.mock("@/industries/education-consultancy/features/processes/ui/process-detail", () => ({ ProcessDetail: () => null }));

class NotFound extends Error {}
class Redirect extends Error { constructor(public to: string) { super(to); } }
vi.mock("next/navigation", () => ({
  notFound: () => { throw new NotFound(); },
  redirect: (to: string) => { throw new Redirect(to); },
}));

import List from "./page";
import Detail from "./[key]/page";

const mk = (industry: string, role: string) => ({ tenant: { industry_id: industry, name: "Admizz" }, role });
const detail = (key = "new_lead_first_call") => Detail({ params: Promise.resolve({ key }) });
beforeEach(() => { tenant.current = mk("education_consultancy", "owner"); });

describe.each([["/processes", () => List()], ["/processes/[key]", () => detail()]])("%s page shell", (_n, call) => {
  it("redirects anonymous to /login", async () => { tenant.current = null; await expect(call()).rejects.toMatchObject({ to: "/login" }); });
  it.each(["it_agency", "travel_agency", "construction", "general", "real_estate"])("notFound() for %s", async (i) => {
    tenant.current = mk(i, "owner"); await expect(call()).rejects.toBeInstanceOf(NotFound);
  });
  it.each(["staff", "viewer", "counselor"])("notFound() for an education %s", async (r) => {
    tenant.current = mk("education_consultancy", r); await expect(call()).rejects.toBeInstanceOf(NotFound);
  });
  it.each(["owner", "admin"])("renders for an education %s", async (r) => {
    tenant.current = mk("education_consultancy", r); await expect(call()).resolves.toBeTruthy();
  });
});

describe("/processes/[key]", () => {
  it("notFound() for an unknown key", async () => { await expect(detail("nope")).rejects.toBeInstanceOf(NotFound); });
});
