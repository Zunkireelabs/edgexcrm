// @vitest-environment jsdom
//
// EDGEX-155: the shared move hook. LeadDetailV2 does not pass `onHandOff`, so a hand-off still goes router.back();
// the education page passes it and owns where to go next. Both must return whether the move went through.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { Lead, LeadList } from "@/types/database";

const back = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back, refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useLeadMoves } from "./use-lead-moves";

const LISTS = [{ id: "q", slug: "qualified", name: "Qualified", sort_order: 2 }] as unknown as LeadList[];
const LEAD = { id: "l1", list_id: "p", stage_id: "s1", assigned_to: "me" } as unknown as Lead;

function setup(extra: { onHandOff?: (i: { lead: Lead; listName: string }) => void } = {}) {
  return renderHook(() =>
    useLeadMoves({
      lead: LEAD, currentLead: LEAD, setCurrentLead: vi.fn(), stageId: "s1", setStageId: vi.fn(), setAssignedTo: vi.fn(),
      userId: "me", industryId: "education_consultancy", bypassQualification: false, leadLists: LISTS, ...extra,
    }),
  );
}
function patchReturns(res: { ok: boolean; assigned_to?: string }) {
  global.fetch = vi.fn(async () => (res.ok
    ? ({ ok: true, json: async () => ({ data: { ...LEAD, list_id: "q", assigned_to: res.assigned_to ?? "me" } }) } as Response)
    : ({ ok: false, json: async () => ({ error: { message: "no" } }) } as Response))) as unknown as typeof fetch;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("useLeadMoves hand-off", () => {
  it("without onHandOff (LeadDetailV2): a hand-off goes router.back()", async () => {
    patchReturns({ ok: true, assigned_to: "u2" });
    const { result } = setup();
    let ok = false;
    await act(async () => { ok = await result.current.performListMove("q", undefined, "u2"); });
    expect(ok).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("with onHandOff (education): it is called INSTEAD of router.back()", async () => {
    patchReturns({ ok: true, assigned_to: "u2" });
    const onHandOff = vi.fn();
    const { result } = setup({ onHandOff });
    await act(async () => { await result.current.performListMove("q", undefined, "u2"); });
    expect(onHandOff).toHaveBeenCalledWith({ lead: expect.objectContaining({ assigned_to: "u2" }), listName: "Qualified" });
    expect(back).not.toHaveBeenCalled();
  });

  it("a move that keeps the lead with the user is not a hand-off", async () => {
    patchReturns({ ok: true, assigned_to: "me" });
    const onHandOff = vi.fn();
    const { result } = setup({ onHandOff });
    let ok = false;
    await act(async () => { ok = await result.current.performListMove("q"); });
    expect(ok).toBe(true);
    expect(onHandOff).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it("reports a failed move as false", async () => {
    patchReturns({ ok: false });
    const { result } = setup();
    let ok = true;
    await act(async () => { ok = await result.current.performListMove("q"); });
    expect(ok).toBe(false);
  });
});
