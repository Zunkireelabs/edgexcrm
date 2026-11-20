// @vitest-environment jsdom
//
// The education lead page must hydrate cleanly: the first client render has to match the server HTML (no storage / matchMedia /
// window reads during render). Server-renders the page, hydrates it, and fails on any React hydration error.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import type { Lead, Tenant } from "@/types/database";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/leads/l1",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { LeadDetailEdu } from "./lead-detail-edu";
import { LEAD_NAV_KEY } from "./lib/lead-nav";

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

const LEAD = { id: "l1", first_name: "Sita", last_name: "Karki", email: "s@x.test", phone: "+9779841234567", list_id: "q", stage_id: "s1", tags: [], created_at: "2026-11-01T00:00:00Z", custom_fields: {} } as unknown as Lead;
const TENANT = { id: "t1", industry_id: "education_consultancy" } as unknown as Tenant;
const el = () => (
  <LeadDetailEdu lead={LEAD} notes={[]} checklists={[]} activities={[]} stages={[]} tenant={TENANT} role="admin" userId="u1" />
);

afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

describe("LeadDetailEdu hydration", () => {
  it("hydrates with no mismatch, even with a stored edgex.leadNav and a phone-width window", async () => {
    // Browser-only state that exists on the client but not on the server:
    sessionStorage.setItem(LEAD_NAV_KEY, JSON.stringify({ viewLabel: "My leads", href: "/leads", query: {}, page: 1, pageSize: 25, ids: ["l0", "l1", "l2"], total: 3 }));
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response) as unknown as typeof fetch;

    const html = renderToString(el());
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;

    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a); });
    const recoverable: unknown[] = [];
    await act(async () => { hydrateRoot(container, el(), { onRecoverableError: (e) => recoverable.push(e) }); });
    spy.mockRestore();
    const hydration = errors.filter((a) => /hydrat|did not match|didn't match/i.test(a.map(String).join(" ")));
    expect(hydration, hydration.map((a) => String(a[0]).slice(0, 600)).join("\n---\n")).toEqual([]);
    expect(recoverable).toEqual([]);
  });
});
