// @vitest-environment jsdom
// EDGEX-146: after a bulk action the leads table must refetch the CURRENT view (same search/status/
// sort/page), and a router.refresh()-style new `leads` prop (always the SSR default first page) must not
// clobber a non-default view. fetch is mocked; no DB.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead } from "@/types/database";
import { LeadsTable } from "./leads-table";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }),
  usePathname: () => "/leads",
  useSearchParams: () => new URLSearchParams(),
}));

function mk(i: number, first = "Lead"): Lead {
  return {
    id: `l-${i}`, tenant_id: "t1", pipeline_id: "p1", session_id: null, step: 1, is_final: true, status: "new",
    first_name: `${first}${i}`, last_name: "X", email: `e${i}@x.test`, phone: null, city: null, country: null,
    custom_fields: {}, file_urls: {}, stage_id: null, assigned_to: null, entity_id: null, intake_source: null,
    intake_medium: null, intake_campaign: null, ref_code: null, form_source: null, preferred_contact_method: null,
    tags: [], lead_type: "student", display_id: `LOC-${i}`, account_id: null, form_config_id: null,
    deleted_at: null, converted_at: null, converted_contact_id: null, idempotency_key: null, ai_score: null,
    ai_priority: null, ai_score_updated_at: null, normalized_email: null, merged_into: null, company_name: null,
    designation: null, prospect_industry: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  } as unknown as Lead;
}

/** In-memory server: 60 leads, "LOC" search matches the first 30. Honors page/pageSize/search/status/count. */
function makeServer() {
  const db = new Map<string, Lead>();
  for (let i = 1; i <= 60; i++) db.set(`l-${i}`, mk(i, i <= 30 ? "Loc" : "Other"));
  const gets: URLSearchParams[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/v1/leads" && method === "GET") {
      gets.push(url.searchParams);
      const q = (url.searchParams.get("search") ?? "").toLowerCase();
      const status = url.searchParams.get("status");
      const rows = [...db.values()].filter((l) => (!q || (l.first_name ?? "").toLowerCase().includes(q)) && (!status || l.status === status));
      const page = Number(url.searchParams.get("page") ?? 1);
      const size = Number(url.searchParams.get("pageSize") ?? 25);
      const body: { data: Lead[]; meta?: { total: number } } = { data: rows.slice((page - 1) * size, page * size) };
      if (url.searchParams.get("count") === "1") body.meta = { total: rows.length };
      return { ok: true, json: async () => body } as Response;
    }
    if (url.pathname === "/api/v1/leads/bulk") {
      const b = JSON.parse(String(init?.body));
      for (const id of b.ids ?? []) db.delete(id);
      return { ok: true, json: async () => ({ data: { deleted: (b.ids ?? []).length, updated: (b.ids ?? []).length } }) } as Response;
    }
    return { ok: true, json: async () => ({ data: [] }) } as Response;
  });
  return { fn, gets, db, last: () => gets[gets.length - 1] };
}

const firstPage = (n = 25) => Array.from({ length: n }, (_, i) => mk(i + 1, "Loc"));
const props = { serverPaginated: true, role: "admin" as const };
const pageText = () => document.body.textContent?.match(/Page (\d+) of (\d+)/)?.slice(1, 3).join("/");

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
const pager = () => screen.getAllByRole("button").filter((x) => x.className.includes("disabled:opacity-30"));

let server: ReturnType<typeof makeServer>;
beforeEach(() => {
  refresh.mockClear();
  server = makeServer();
  global.fetch = server.fn as never;
});
afterEach(() => cleanup());

async function deleteSelectedOnPage() {
  fireEvent.click(screen.getByLabelText("Select all"));
  fireEvent.click(await screen.findByRole("button", { name: /^Delete$/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^Delete \d+ leads?/ }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
}

describe("EDGEX-146 leads table keeps its view after a bulk action", () => {
  it("(a) keeps the search", async () => {
    render(<LeadsTable leads={firstPage()} initialTotal={60} {...props} />);
    const box = screen.getByPlaceholderText("Search leads...");
    fireEvent.change(box, { target: { value: "loc" } });
    await waitFor(() => expect(server.last()?.get("search")).toBe("loc"), { timeout: 3000 });
    await waitFor(() => expect(pageText()).toBe("1/2"));
    const before = server.gets.length;
    await deleteSelectedOnPage();
    await waitFor(() => expect(server.gets.length).toBeGreaterThan(before));
    expect(server.last()?.get("search")).toBe("loc");
    expect(server.last()?.get("page")).toBe("1");
    expect(server.last()?.get("count")).toBe("1"); // fresh exact count
    expect(box).toHaveValue("loc");
    await waitFor(() => expect(pageText()).toBe("1/1")); // 30 - 25 deleted = 5 left
  });

  it("(b) keeps page 2 after a bulk action", async () => {
    render(<LeadsTable leads={firstPage()} initialTotal={60} {...props} />);
    const next = pager()[1];
    fireEvent.click(next);
    await waitFor(() => expect(server.last()?.get("page")).toBe("2"));
    await waitFor(() => expect(pageText()).toBe("2/3"));
    // delete only the first row of page 2 so page 2 stays populated
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(await screen.findByRole("button", { name: /^Delete$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Delete 1 lead/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(server.last()?.get("count")).toBe("1"));
    expect(server.last()?.get("page")).toBe("2");
    expect(pageText()).toBe("2/3");
  });

  it("(c) keeps the status filter", async () => {
    server.db.forEach((l, id) => { if (Number(id.slice(2)) % 2 === 0) l.status = "contacted"; });
    render(<LeadsTable leads={firstPage()} initialTotal={60} {...props} />);
    const open = async (name: RegExp | string) => {
      const b = await screen.findByRole("button", { name });
      fireEvent.pointerDown(b, { button: 0, ctrlKey: false });
      fireEvent.click(b);
    };
    await open("Filters");
    await open(/^Status/);
    fireEvent.click(await screen.findByText(/^contacted$/i));
    await waitFor(() => expect(server.last()?.get("status")).toBe("contacted"));
    await waitFor(() => expect(pageText()).toBe("1/2")); // 30 contacted
    await deleteSelectedOnPage();
    await waitFor(() => expect(server.last()?.get("count")).toBe("1"));
    expect(server.last()?.get("status")).toBe("contacted");
    expect(server.last()?.get("page")).toBe("1");
  });

  it("(d) steps back when the last page is emptied", async () => {
    render(<LeadsTable leads={firstPage()} initialTotal={60} {...props} />);
    fireEvent.click(pager()[1]);
    await waitFor(() => expect(pageText()).toBe("2/3"));
    fireEvent.click(pager()[1]);
    await waitFor(() => expect(pageText()).toBe("3/3"));
    await deleteSelectedOnPage(); // page 3 had 10 rows -> 50 left -> 2 pages
    await waitFor(() => expect(pageText()).toBe("2/2"));
    expect(server.last()?.get("page")).toBe("2");
  });
});

describe("EDGEX-146 SSR `leads` prop sync", () => {
  it("(e) a refresh-style new prop does NOT overwrite a searched view, DOES apply on the default view and on a list switch", async () => {
    const seed = firstPage();
    const { rerender } = render(<LeadsTable leads={seed} initialTotal={60} {...props} />);
    const fresh = Array.from({ length: 25 }, (_, i) => mk(i + 100, "Fresh"));

    // default view: applies
    rerender(<LeadsTable leads={fresh} initialTotal={59} {...props} />);
    await waitFor(() => expect(screen.getAllByText(/Fresh100/).length).toBeGreaterThan(0));

    // searched view: ignored
    fireEvent.change(screen.getByPlaceholderText("Search leads..."), { target: { value: "loc" } });
    await waitFor(() => expect(server.last()?.get("search")).toBe("loc"), { timeout: 3000 });
    await waitFor(() => expect(screen.queryAllByText(/Fresh100/).length).toBe(0));
    const stale = Array.from({ length: 25 }, (_, i) => mk(i + 200, "Stale"));
    rerender(<LeadsTable leads={stale} initialTotal={999} {...props} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryAllByText(/Stale200/).length).toBe(0);
    expect(pageText()).toBe("1/2");

    // list switch: applies even though the client view is non-default
    const switched = Array.from({ length: 25 }, (_, i) => mk(i + 300, "Switched"));
    rerender(<LeadsTable leads={switched} initialTotal={25} {...props} activeListSlug="qualified" />);
    await waitFor(() => expect(screen.getAllByText(/Switched300/).length).toBeGreaterThan(0));
  });
});
