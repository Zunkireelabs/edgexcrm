// @vitest-environment jsdom
//
// EDGEX-155: the moves on the education lead detail. Revert's optional "Why" is saved as a lead note ONLY after the move
// went through; a hand-off opens the user's next lead from edgex.leadNav (or goes back to the view when there is none).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lead, LeadList } from "@/types/database";
import { LEAD_NAV_KEY } from "./lib/lead-nav";

const push = vi.fn();
const back = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, back, refresh, replace: vi.fn() }) }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn() } }));
vi.mock("@/hooks/use-edu-taxonomy", () => ({ useEduTaxonomy: () => ({ destinations: [], fieldsOfStudy: [], studyLevels: [] }) }));

import { useLeadActions } from "./use-lead-actions";

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
Element.prototype.scrollIntoView = () => {};

const list = (id: string, slug: string, name: string, sort_order: number): LeadList => ({ id, slug, name, sort_order, is_archive: false, is_staging: false, is_intake: sort_order === 1 } as unknown as LeadList);
const LISTS = [list("pre", "pre-qualified", "Pre-qualified", 1), list("q", "qualified", "Qualified", 2), list("p", "prospects", "Prospects", 3)];
const LEAD = { id: "l1", first_name: "Sita", last_name: "Karki", list_id: "p", stage_id: "s1", assigned_to: "me", pre_app_fee_status: null } as unknown as Lead;

// The harness hands the hook's return value to the test through a mutable holder (set in an effect, not during render).
const holder: { api: ReturnType<typeof useLeadActions> | null } = { api: null };
const api = () => holder.api!;
function Harness(props: { revertTargetUserId?: string | null; revertTargetMembers?: { user_id: string; email: string; name?: string }[] }) {
  const hook = useLeadActions({
    lead: LEAD, userId: "me", leadLists: LISTS, activeLeadLists: LISTS, bypassQualification: false, nextPositionMembers: [],
    revertTargetUserId: props.revertTargetUserId ?? null, revertTargetName: null, revertTargetMembers: props.revertTargetMembers ?? [], stageAssigneeMap: {},
    memberNames: { u2: "Farhan Ali" }, fallbackHref: "/leads", openStudentDetails: () => {},
  });
  useEffect(() => { holder.api = hook; });
  return <>{hook.dialogs}</>;
}

type Call = { url: string; method: string; body: Record<string, unknown> };
let calls: Call[] = [];
function mockFetch(patch: { ok: boolean; assigned_to?: string }) {
  calls = [];
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: u, method, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (method === "PATCH") {
      return patch.ok
        ? ({ ok: true, status: 200, json: async () => ({ data: { ...LEAD, list_id: "q", assigned_to: patch.assigned_to ?? "me" } }) } as Response)
        : ({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) } as Response);
    }
    if (method === "POST") return { ok: true, status: 201, json: async () => ({ data: {} }) } as Response;
    if (u.includes("/api/v1/leads/b")) return { ok: true, status: 200, json: async () => ({ data: { id: "b", first_name: "Ram", last_name: "Thapa" } }) } as Response;
    return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function openRevert() {
  render(<Harness />);
  await act(async () => { await api().startMove(LISTS[1], "back"); });
  expect(await screen.findByText("Revert to Qualified?")).toBeInTheDocument();
}

describe("Revert: the Why note", () => {
  it("is saved as a lead note only AFTER the move succeeded", async () => {
    mockFetch({ ok: true });
    await openRevert();
    fireEvent.change(screen.getByLabelText(/Why/), { target: { value: "Not reachable, wrong number" } });
    fireEvent.click(screen.getByRole("button", { name: /^Revert/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/notes"))).toBe(true));
    const patchAt = calls.findIndex((c) => c.method === "PATCH");
    const noteAt = calls.findIndex((c) => c.method === "POST" && c.url.endsWith("/notes"));
    expect(patchAt).toBeGreaterThanOrEqual(0);
    expect(noteAt).toBeGreaterThan(patchAt);
    expect(calls[noteAt].body).toEqual({ content: "Not reachable, wrong number" });
  });

  it("is NOT saved when the move fails", async () => {
    mockFetch({ ok: false });
    await openRevert();
    fireEvent.change(screen.getByLabelText(/Why/), { target: { value: "Should not be saved" } });
    fireEvent.click(screen.getByRole("button", { name: /^Revert/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("writes no note when Why is blank", async () => {
    mockFetch({ ok: true });
    await openRevert();
    fireEvent.click(screen.getByRole("button", { name: /^Revert/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("hand-off", () => {
  const nav = (ids: string[]) => sessionStorage.setItem(LEAD_NAV_KEY, JSON.stringify({ viewLabel: "My leads", href: "/leads?view=mine", query: {}, page: 1, pageSize: 25, ids, total: ids.length }));
  const members = [{ user_id: "u2", email: "f@x.test", name: "Farhan Ali" }];

  async function revertTo() {
    render(<Harness revertTargetUserId="u2" revertTargetMembers={members} />);
    await act(async () => { await api().startMove(LISTS[1], "back"); });
    await screen.findByText("Revert to Qualified?");
    fireEvent.click(screen.getByRole("button", { name: /^Revert/ }));
  }

  it("opens the user's NEXT lead from edgex.leadNav and says so", async () => {
    nav(["l1", "b", "c"]);
    mockFetch({ ok: true, assigned_to: "u2" });
    await revertTo();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/leads/b"));
    expect(back).not.toHaveBeenCalled();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Sita Karki sent to Farhan Ali · Qualified", { description: "Opened your next lead: Ram Thapa" }));
  });

  it("goes back to the view when there is no next lead", async () => {
    nav(["l1"]);
    mockFetch({ ok: true, assigned_to: "u2" });
    await revertTo();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/leads?view=mine"));
    expect(toastSuccess).toHaveBeenCalledWith("Sita Karki sent to Farhan Ali · Qualified");
  });

  it("goes back to the fallback view when nothing was stored", async () => {
    mockFetch({ ok: true, assigned_to: "u2" });
    await revertTo();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/leads"));
  });
});
