// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("sonner", () => ({ toast }));

import { SmartAssignmentCard, processSuggestHref } from "../../home/ui/smart-assignment-card";
import { OfficeHoursCard, officeHoursStatus } from "./office-hours-card";
import type { OfficeHoursView } from "../server/office-hours";

const json = (data: unknown, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => (ok ? { data } : { error: { message: String(data) } }) } as Response);
let calls: Array<{ url: string; method: string; body: unknown }> = [];
function mockFetch(routes: Record<string, () => Promise<Response>>) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const hit = Object.keys(routes).find((k) => `${init?.method ?? "GET"} ${url}`.startsWith(k));
    return hit ? routes[hit]() : json("no route", false, 404);
  }));
}
beforeEach(() => { toast.success.mockClear(); toast.error.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const view = (o: Partial<OfficeHoursView> = {}): OfficeHoursView => ({
  days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, source: "learned", tz: "Asia/Kathmandu", events: 8000, updatedAt: null, updatedByName: null,
  usedBy: { processKey: "new_lead_first_call", name: "New lead → first call", version: 2, summary: "first contact within 1 working hour, assign within 5 minutes" },
  evidence: { byWeekday: [1533, 1264, 1613, 1513, 1548, 801, 11], byHour: Array(24).fill(0).map((_, h) => (h >= 9 && h < 18 ? 100 : 0)), total: 8283, windowDays: 90 },
  ...o,
});
const URL = "/api/v1/settings/office-hours";

describe("officeHoursStatus", () => {
  it("learned with enough events, learned with too few, saved", () => {
    expect(officeHoursStatus(view())).toEqual({ label: "Set from your data · last 90 days", notEnough: false });
    expect(officeHoursStatus(view({ events: 120 }))).toEqual({ label: "Not enough activity yet to learn your hours; showing every day 9–6.", notEnough: true });
    expect(officeHoursStatus(view({ source: "saved", updatedByName: "Sadin", updatedAt: "2026-11-08T06:00:00Z", events: null }))).toEqual({ label: "Saved by Sadin on 8 Nov", notEnough: false });
  });
  it("the saved date is cut in the tenant zone", () => {
    const v = view({ source: "saved", updatedByName: "S", updatedAt: "2026-11-07T20:00:00Z" });
    expect(officeHoursStatus(v).label).toBe("Saved by S on 8 Nov");
    expect(officeHoursStatus({ ...v, tz: "America/New_York" }).label).toBe("Saved by S on 7 Nov");
  });
});

describe("T3 Office hours card", () => {
  it("learned: days toggled on Sun–Fri, 9:00 am to 6:00 pm, the evidence bars, the 'Used by' link, and Save is ready (nothing confirmed yet)", async () => {
    mockFetch({ [`GET ${URL}`]: () => json(view()) });
    render(<OfficeHoursCard />);
    expect(await screen.findByText("Set from your data · last 90 days")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sat" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Sun" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Opens") as HTMLSelectElement).value).toBe("540");
    expect((screen.getByLabelText("Closes") as HTMLSelectElement).value).toBe("1080");
    expect(screen.getByText("Sat · 11")).toBeTruthy();
    expect(screen.getByText("Sun · 1,533")).toBeTruthy();
    expect(screen.getByText(/Your team logged 801 to 1,613 calls and notes/)).toBeTruthy();
    expect(screen.getByText("New lead → first call v2").getAttribute("href")).toBe("/processes/new_lead_first_call");
    expect(screen.getByText(/first contact within 1 working hour, assign within 5 minutes/)).toBeTruthy();
    expect(screen.getByText("Changes are logged in EdgeX improvements.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("under 200 events: says so instead of 'set from your data'", async () => {
    mockFetch({ [`GET ${URL}`]: () => json(view({ events: 120, days: [0, 1, 2, 3, 4, 5, 6] })) });
    render(<OfficeHoursCard />);
    expect(await screen.findByText("Not enough activity yet to learn your hours; showing every day 9–6.")).toBeTruthy();
  });
  it("no live process on a working clock: says so, no link", async () => {
    mockFetch({ [`GET ${URL}`]: () => json(view({ usedBy: null })) });
    render(<OfficeHoursCard />);
    expect(await screen.findByText("No live process counts working time yet.")).toBeTruthy();
  });
  it("saved: 'Saved by …' above the evidence; Save waits for a change; toggling Saturday then Save PUTs the new days and shows the saved value", async () => {
    const saved = view({ source: "saved", updatedByName: "Sadin", updatedAt: "2026-11-08T06:00:00Z", events: null });
    mockFetch({ [`GET ${URL}`]: () => json(saved), [`PUT ${URL}`]: () => json({ ...saved, days: [0, 1, 2, 3, 4, 5, 6], updatedByName: "Sadin" }) });
    render(<OfficeHoursCard />);
    expect(await screen.findByText("Saved by Sadin on 8 Nov")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Sat" }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Office hours saved"));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ days: [0, 1, 2, 3, 4, 5, 6], startMin: 540, endMin: 1080 });
    expect(screen.getByRole("button", { name: "Sat" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("no days or closing before opening disables Save", async () => {
    mockFetch({ [`GET ${URL}`]: () => json(view({ source: "saved", updatedByName: "S", updatedAt: "2026-11-08T06:00:00Z", events: null })) });
    render(<OfficeHoursCard />);
    await screen.findByText(/Saved by S/);
    fireEvent.change(screen.getByLabelText("Closes"), { target: { value: "480" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Closing time must be after opening time");
  });
  it("a failed save says so and keeps the form", async () => {
    mockFetch({ [`GET ${URL}`]: () => json(view()), [`PUT ${URL}`]: () => json("boom", false, 500) });
    render(<OfficeHoursCard />);
    await screen.findByText("Set from your data · last 90 days");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

describe("T4 smart assignment: who takes new leads", () => {
  const proc = { key: "new_lead_first_call", name: "New lead → first call", version: 2, step: "First contact", positions: [{ slug: "counselor", name: "Counselor" }, { slug: "lead-executive", name: "Lead Executive" }] };
  const suggestion = { window_days: 60, positions: [{ slug: "counselor", name: "Counselor", count: 368 }, { slug: "lead-executive", name: "Lead Executive", count: 95 }, { slug: "x", name: "Admin", count: 13 }], chosen: ["counselor"], total: 476, covered: 463 };
  const A = "/api/v1/settings/lead-assignment";

  it("a live process: read-only chips, 'from … v2, step First contact', the sentence, Suggest a change deep link, the 60-day evidence, and no checkboxes", async () => {
    mockFetch({ [`GET ${A}`]: () => json({ mode: "off", first_touch_positions: ["counselor", "lead-executive"], positions_saved: false, suggestion, process: proc }) });
    render(<SmartAssignmentCard />);
    expect(await screen.findByText("Who takes new leads")).toBeTruthy();
    expect(screen.getByText("Counselor")).toBeTruthy();
    expect(screen.getByText("Lead Executive")).toBeTruthy();
    expect(screen.getByText("New lead → first call v2").getAttribute("href")).toBe("/processes/new_lead_first_call");
    expect(screen.getByText("First contact")).toBeTruthy();
    expect(screen.getByText(/To change who takes new leads, suggest a change to that step\. Once the process owner approves it, smart assignment follows\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Suggest a change/ }).getAttribute("href")).toBe("/processes/new_lead_first_call?suggest=first_contact&field=who");
    expect(screen.getByText(/Your new leads went to Counselor \(368\), Lead Executive \(95\) and Admin \(13\)\./)).toBeTruthy();
    expect(screen.getByText("Last 60 days")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("Use these")).toBeNull();
  });
  it("no live process: today's checkbox picker is unchanged", async () => {
    mockFetch({ [`GET ${A}`]: () => json({ mode: "off", first_touch_positions: ["counselor"], positions_saved: false, suggestion, process: null }) });
    render(<SmartAssignmentCard />);
    expect(await screen.findByText("Use these")).toBeTruthy();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /Suggest a change/ })).toBeNull();
  });
  it("the deep link", () => {
    expect(processSuggestHref(proc)).toBe("/processes/new_lead_first_call?suggest=first_contact&field=who");
  });
});

describe("T4 deep link: the suggest sheet opens on First contact → who", () => {
  it("opens the sheet on that step with the Who field", async () => {
    const { buildBaselineSpec } = await import("../lib/baseline");
    const { ADMIZZ_NEW_LEAD_RAW, ADMIZZ_SETUP } = await import("../lib/fixtures");
    const { buildStepViews, buildTrigger } = await import("../server/load-processes");
    const { SuggestSheet } = await import("./suggest-sheet");
    const KEY = "new_lead_first_call" as const;
    const spec = buildBaselineSpec(KEY, ADMIZZ_SETUP);
    const steps = buildStepViews(KEY, spec, ADMIZZ_NEW_LEAD_RAW);
    const p = {
      key: KEY, name: "New lead → first call", processId: "p1", ownerUserId: "u1", ownerName: "Manish", reviewDueAt: null, createdAt: "2026-11-07T10:00:00Z",
      shown: { id: "v1", version: 1, status: "live", source: "system", approvedAt: "2026-11-07T11:00:00Z", changeSummary: null },
      headline: steps[1], headlineStyle: "percent", headlineLabel: "x", summary: "s", trigger: buildTrigger(KEY, ADMIZZ_NEW_LEAD_RAW), drivesSummary: "", stepOwners: [], drives: [],
      rules: null, rulesFooter: "", steps, spec, specError: null, canApprove: true, draft: null,
    } as unknown as Parameters<typeof SuggestSheet>[0]["p"];
    render(<SuggestSheet open onOpenChange={() => {}} p={p} days={30} positions={[{ slug: "counselor", name: "Counselor" }]} nextVersion={2} draftChanges={0} liveVersion={1} onAdded={() => {}} initialPart="step:first_contact" initialField="who" />);
    expect((await screen.findByRole("radio", { name: /First contact/ })).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Who does it" }).getAttribute("aria-checked")).toBe("true");
  });
});
