// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { push, toast } = vi.hoisted(() => ({ push: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("sonner", () => ({ toast }));

import { buildBaselineSpec } from "../lib/baseline";
import { ADMIZZ_NEW_LEAD_RAW, ADMIZZ_SETUP } from "../lib/fixtures";
import { buildStepViews, buildTrigger, type ProcessView } from "../server/load-processes";
import type { ChangeView, DraftView } from "../server/changes";
import type { VersionsPage as VersionsPayload } from "../server/compare";
import type { LogEvent } from "../lib/improvements-log";
import { toAfter, editFromValue } from "./change-fields";
import { evidenceOptions, splitLeadingNumber } from "./evidence";
import { DraftReview } from "./draft-review";
import { ImprovementsPage } from "./improvements-page";
import { ProcessesPage } from "./processes-page";
import { SuggestSheet } from "./suggest-sheet";
import { VersionsPage, changeText, changeTone } from "./versions-page";

const KEY = "new_lead_first_call" as const;
const spec = buildBaselineSpec(KEY, ADMIZZ_SETUP);
const POSITIONS = [{ slug: "counselor", name: "Counselor" }, { slug: "lead-executive", name: "Lead Executive" }];

const processView = (over: Partial<ProcessView> = {}): ProcessView => {
  const steps = buildStepViews(KEY, spec, ADMIZZ_NEW_LEAD_RAW);
  return {
    key: KEY, name: "New lead → first call", processId: "p1", ownerUserId: "u1", ownerName: "Manish Sah", reviewDueAt: null, createdAt: "2026-11-07T10:00:00Z",
    shown: { id: "v1", version: 1, status: "live", source: "system", approvedAt: "2026-11-07T11:00:00Z", changeSummary: null },
    headline: steps[1], headlineStyle: "percent", headlineLabel: "contacted within 1 hour", summary: "s", trigger: buildTrigger(KEY, ADMIZZ_NEW_LEAD_RAW),
    drivesSummary: "Home rules", stepOwners: [], drives: [], rules: null, rulesFooter: "", steps, spec, specError: null, canApprove: true, draft: null, ...over,
  };
};

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
beforeEach(() => { push.mockClear(); toast.success.mockClear(); toast.error.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("pure helpers", () => {
  it("changeText / changeTone", () => {
    expect(changeText("percent", 54)).toBe("+54 pts");
    expect(changeText("percent", -38)).toBe("−38 pts");
    expect(changeText("min", -99)).toBe("−99%");
    expect(changeText("count", 3)).toBe("+3");
    expect(changeText("percent", 7.5)).toBe("+7.5 pts");
    expect(changeTone({ better: "up" }, 5)).toBe("good");
    expect(changeTone({ better: "down" }, -5)).toBe("good");
    expect(changeTone({ better: "down" }, 5)).toBe("bad");
    expect(changeTone({ better: "up" }, 0)).toBe("flat");
  });
  it("splitLeadingNumber bolds the leading figure only", () => {
    expect(splitLeadingNumber("62 arrived outside 9–6")).toEqual({ bold: "62", rest: " arrived outside 9–6" });
    expect(splitLeadingNumber("60 of 132 arrived")).toEqual({ bold: "60 of 132", rest: " arrived" });
    expect(splitLeadingNumber("17% Contacted")).toEqual({ bold: "17%", rest: " Contacted" });
    expect(splitLeadingNumber("Median 14 h")).toEqual({ bold: "", rest: "Median 14 h" });
  });
  it("evidence options come from the trigger sentences and the steps' live numbers", () => {
    const opts = evidenceOptions(processView());
    expect(opts.some((o) => o.evidence.metric === "trigger" && o.bold === "62")).toBe(true);
    expect(opts.some((o) => o.evidence.stepKey === "first_contact" && o.bold === "17%")).toBe(true);
    expect(opts.length).toBeLessThanOrEqual(12);
  });
  it("toAfter / editFromValue round-trip each field", () => {
    expect(toAfter("target", "step:first_contact", { ...editFromValue("target", "step:first_contact", { value: 80, metric: "first_contact_1h_pct" }), value: "75" }, true)).toEqual({ ok: true, after: { value: 75, metric: "first_contact_1h_pct" } });
    expect(toAfter("target", "step:assign", editFromValue("target", "step:assign", { value: 90, metric: "owner_within_5min_pct" }), false)).toEqual({ ok: true, after: { value: 90 } });
    expect(toAfter("target", "step:x", { ...editFromValue("target", "step:x", null), value: "abc" }, false).ok).toBe(false);
    expect(toAfter("who", "step:x", { ...editFromValue("who", "step:x", []), slugs: [] }, false).ok).toBe(false);
    expect(toAfter("wording", "exceptions", editFromValue("wording", "exceptions", ["a", "b"]), false)).toEqual({ ok: true, after: ["a", "b"] });
    expect(toAfter("wording", "trigger", { ...editFromValue("wording", "trigger", "x"), text: "  " }, false).ok).toBe(false);
  });
});

describe("list: draft chip + Review draft", () => {
  const list = (draft: ProcessView["draft"], canApprove = true) => ({ windowDays: 30, baselinesCreated: [], processes: [processView({ draft, canApprove })], improvements: [], tz: "UTC" });
  it("shows 'Draft v2 · 2 changes' after the live pill and a Review draft button to the review page", async () => {
    mockFetch({ "GET /api/v1/processes": () => json(list({ id: "d2", version: 2, changeCount: 2, source: "person", summary: null, orca: null })) });
    render(<ProcessesPage tenantName="Admizz" />);
    expect(await screen.findByText("Draft v2 · 2 changes")).toBeTruthy();
    const btn = screen.getByRole("link", { name: "Review draft" });
    expect(btn.getAttribute("href")).toBe("/processes/new_lead_first_call/draft");
    expect(btn.className).toContain("bg-ds-ink"); // primary for an approver
    expect(screen.getByText("v1 live")).toBeTruthy();
  });
  it("is the secondary look for someone who can't approve; 'Needs you' counts the open draft", async () => {
    mockFetch({ "GET /api/v1/processes": () => json(list({ id: "d2", version: 2, changeCount: 1, source: "person", summary: null, orca: null }, false)) });
    render(<ProcessesPage tenantName="Admizz" />);
    const btn = await screen.findByRole("link", { name: "Review draft" });
    expect(btn.className).not.toContain("bg-ds-ink");
    expect(screen.getByText("Draft v2 · 1 change")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Needs you/ }).textContent).toContain("1");
  });
  it("no draft -> plain 'Open'; the card shows the latest events with an All → link", async () => {
    mockFetch({ "GET /api/v1/processes": () => json({ ...list(null), improvements: [{ at: new Date().toISOString(), kind: "baseline", text: "4 processes written from your data", meta: "v1 as-is baseline of each", versionId: "v", processKey: KEY, processKeys: [KEY], processName: "n", version: 1, actor: null, reason: null, beforeAfter: false, measures: null }] }) });
    render(<ProcessesPage tenantName="Admizz" />);
    expect(await screen.findByText("Open")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Review draft" })).toBeNull();
    expect(screen.getByRole("link", { name: "All →" }).getAttribute("href")).toBe("/processes/improvements");
    expect(screen.getByText("4 processes written from your data")).toBeTruthy();
  });
});

describe("S1 Suggest a change", () => {
  const renderSheet = () =>
    render(<SuggestSheet open onOpenChange={() => {}} p={processView()} days={30} positions={POSITIONS} nextVersion={2} draftChanges={0} liveVersion={1} onAdded={vi.fn()} />);

  it("renders the four steps and the draft footer, with Add disabled until a change and a reason exist", async () => {
    renderSheet();
    expect(await screen.findByText("Suggest a change")).toBeTruthy();
    expect(screen.getByText(/1\. What do you want to change\?/)).toBeTruthy();
    expect(screen.getByText(/2\. Which part of it\?/)).toBeTruthy();
    expect(screen.getByText(/3\. Your change/)).toBeTruthy();
    expect(screen.getByText(/4\. Why\?/)).toBeTruthy();
    expect(screen.getByText("Draft v2 has 0 changes yet. This will be the first.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add to draft v2" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(screen.getByRole("radiogroup", { name: /What do you want to change/ })).getAllByRole("radio").length).toBe(spec.steps.length + 2); // trigger + steps + exceptions
  });

  it("posts the target change with the option, the reason and the ticked evidence, then reloads", async () => {
    const onAdded = vi.fn();
    mockFetch({ "POST /api/v1/processes/new_lead_first_call/changes": () => json({ draftId: "d2", version: 2, createdDraft: true }, true, 201) });
    render(<SuggestSheet open onOpenChange={() => {}} p={processView()} days={30} positions={POSITIONS} nextVersion={2} draftChanges={0} liveVersion={1} onAdded={onAdded} />);
    // The red "First contact" row is preselected (first red step is "Gets an owner"): pick First contact explicitly.
    fireEvent.click(await screen.findByRole("radio", { name: /First contact/ }));
    fireEvent.change(screen.getByLabelText("Counted"), { target: { value: "first_contact_1wh_pct" } });
    fireEvent.change(screen.getByPlaceholderText(/What are you seeing/), { target: { value: "Almost half arrive after 6 pm." } });
    fireEvent.click(screen.getAllByRole("checkbox").find((c) => c.closest("label")?.textContent?.includes("outside"))!);
    fireEvent.click(screen.getByRole("button", { name: "Add to draft v2" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    const body = calls.find((c) => c.method === "POST")!.body as { part: string; field: string; after: unknown; why: string; evidence: Array<{ metric: string }> };
    expect(body).toMatchObject({ part: "step:first_contact", field: "target", after: { value: 80, metric: "first_contact_1wh_pct" }, why: "Almost half arrive after 6 pm." });
    expect(body.evidence.map((e) => e.metric)).toEqual(["trigger"]);
    expect(toast.success).toHaveBeenCalledWith("Added to draft v2");
  });

  it("shows the API's message when it refuses", async () => {
    mockFetch({ "POST /api/v1/processes/new_lead_first_call/changes": () => json("A percent target must be between 0 and 100", false, 422) });
    renderSheet();
    fireEvent.click(await screen.findByRole("radio", { name: /First contact/ }));
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "150" } });
    fireEvent.change(screen.getByPlaceholderText(/What are you seeing/), { target: { value: "why" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to draft v2" }));
    expect((await screen.findByRole("alert")).textContent).toContain("between 0 and 100");
  });

  it("a trigger offers only the wording; an unchanged value cannot be sent", async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole("radio", { name: /Trigger/ }));
    expect(screen.queryByRole("radio", { name: "The target" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/What are you seeing/), { target: { value: "why" } });
    expect(screen.getByText(/same as now/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add to draft v2" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("S2 review draft", () => {
  const change = (o: Partial<ChangeView>): ChangeView => ({
    id: "c1", part: "step:first_contact", field: "target", title: "First contact: count in working hours", stepKey: "first_contact",
    before: { value: 80, metric: "first_contact_1h_pct" }, after: { value: 80, metric: "first_contact_1wh_pct" },
    beforeText: "within 1 hour · target 80%", afterText: "within 1 working hour · target 80%", why: "Almost half arrive after 6 pm.",
    evidence: [{ metric: "trigger", label: "62 arrived outside 9–6", value: 62, stepKey: null }], authorKind: "person", authorUserId: "u1", authorName: "Manish",
    status: "open", taken: true, editedByName: null, editedAt: null, createdAt: "2026-11-08T00:00:00Z", drives: "Home: new lead not called uses the new target", needs: null, turnsOn: null, ...o,
  });
  const view = (over: Partial<DraftView> = {}, changes: ChangeView[] = [change({}), change({ id: "c2", title: "Call-back kept: new wording", field: "wording", part: "step:call_back", stepKey: "call_back", before: "a", after: "b", beforeText: "a", afterText: "b", why: "Re-books are not misses.", evidence: [], drives: "No product change: wording only" })]): DraftView => ({
    process: { key: KEY, name: "New lead → first call", processId: "p1", ownerUserId: "u1", ownerName: "Manish Sah", canApprove: true },
    viewerName: "Manish", positions: POSITIONS, live: { id: "v1", version: 1, approvedAt: "2026-11-07T00:00:00Z" },
    draft: { id: "d2", version: 2, createdAt: "2026-11-08T00:00:00Z", isBaseline: false, source: "person", summary: null, orca: null, authors: [{ userId: "u1", kind: "person", name: "Manish" }], changes },
    ...over,
  });

  it("shows the author chip, each change's now → proposed, the reason with evidence, and the drives line", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/draft": () => json(view()) });
    render(<DraftReview processKey={KEY} />);
    expect(await screen.findByText("Review draft v2")).toBeTruthy();
    expect(screen.getByText("Suggested by Manish")).toBeTruthy();
    expect(screen.getByText("First contact: count in working hours")).toBeTruthy();
    expect(screen.getByText("within 1 hour · target 80%")).toBeTruthy();
    expect(screen.getByText("within 1 working hour · target 80%")).toBeTruthy();
    expect(screen.getByText(/Manish: “Almost half arrive after 6 pm\.”/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /62 arrived outside 9–6/ }).getAttribute("href")).toBe("/processes/new_lead_first_call#step-trigger");
    expect(screen.getByText("Changes: Home: new lead not called uses the new target")).toBeTruthy();
    expect(screen.getByText("No product change: wording only")).toBeTruthy();
    expect(screen.getByText(/the 2 ticked changes/)).toBeTruthy();
  });

  it("several authors read 'Manish and 1 other'", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/draft": () => json(view({ draft: { ...view().draft!, authors: [{ userId: "u1", kind: "person", name: "Manish" }, { userId: "u2", kind: "person", name: "Asha" }] } })) });
    render(<DraftReview processKey={KEY} />);
    expect(await screen.findByText("Suggested by Manish and 1 other")).toBeTruthy();
  });

  it("unticking saves the tick, updates the bar and keeps the change; zero ticked disables Approve", async () => {
    mockFetch({
      "GET /api/v1/processes/new_lead_first_call/draft": () => json(view()),
      "PATCH /api/v1/processes/new_lead_first_call/changes/": () => json({ change: {} }),
    });
    render(<DraftReview processKey={KEY} />);
    const sw = await screen.findAllByRole("switch");
    fireEvent.click(sw[1]);
    await waitFor(() => expect(screen.getByText(/the 1 ticked change\./)).toBeTruthy());
    expect(screen.getByText(/The unticked one is kept as "not taken"/)).toBeTruthy();
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ url: "/api/v1/processes/new_lead_first_call/changes/c2", body: { taken: false } });
    fireEvent.click(sw[0]);
    await waitFor(() => expect((screen.getByRole("button", { name: /Approve v2/ }) as HTMLButtonElement).disabled).toBe(true));
  });

  it("a failed tick is put back and says why", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/draft": () => json(view()), "PATCH ": () => json("Only a draft can be edited", false, 409) });
    render(<DraftReview processKey={KEY} />);
    const sw = await screen.findAllByRole("switch");
    fireEvent.click(sw[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Only a draft can be edited"));
    expect(sw[0].getAttribute("aria-checked")).toBe("true");
  });

  it("approve posts, then goes to before → after", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/draft": () => json(view()), "POST /api/v1/processes/new_lead_first_call/versions/d2/approve": () => json({ approved: true }) });
    render(<DraftReview processKey={KEY} />);
    fireEvent.click(await screen.findByRole("button", { name: /Approve v2/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/processes/new_lead_first_call/versions"));
  });

  it("approve shows the API's refusal and stays", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/draft": () => json(view()), "POST ": () => json("Tick at least one change, or reject the draft", false, 409) });
    render(<DraftReview processKey={KEY} />);
    fireEvent.click(await screen.findByRole("button", { name: /Approve v2/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("Tick at least one change");
    expect(push).not.toHaveBeenCalled();
  });

  it("reject needs a reason, posts it, and returns to the process with a toast", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/draft": () => json(view()), "POST /api/v1/processes/new_lead_first_call/versions/d2/reject": () => json({ rejected: true }) });
    render(<DraftReview processKey={KEY} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reject draft" }));
    expect(await screen.findByText("Reject draft v2?")).toBeTruthy();
    const confirm = screen.getAllByRole("button", { name: "Reject draft" }).at(-1) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Why \(one line, required\)/), { target: { value: "Test with two counsellors first." } });
    fireEvent.click(confirm);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/processes/new_lead_first_call"));
    expect(calls.find((c) => c.url.endsWith("/reject"))?.body).toEqual({ reason: "Test with two counsellors first." });
    expect(toast.success).toHaveBeenCalledWith("Draft v2 rejected. v1 stays live.");
  });

  it("someone who can't approve sees the changes read-only: no switches, no Edit, no approve", async () => {
    const v = view();
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/draft": () => json({ ...v, process: { ...v.process, canApprove: false } }) });
    render(<DraftReview processKey={KEY} />);
    await screen.findByText("Review draft v2");
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.getAllByText("Included")).toHaveLength(2);
    expect(screen.getAllByText(/Only Manish Sah or a tenant owner/).length).toBeGreaterThan(0);
  });

  it("Edit opens the S1 inputs for that field and saves only the value", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/draft": () => json(view()), "PATCH /api/v1/processes/new_lead_first_call/changes/c1": () => json({ change: {} }) });
    render(<DraftReview processKey={KEY} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ after: { value: 75, metric: "first_contact_1wh_pct" } }));
  });

  it("a baseline-only or empty draft has nothing to review", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/draft": () => json(view({ draft: null })) });
    render(<DraftReview processKey={KEY} />);
    expect(await screen.findByText("No draft to review")).toBeTruthy();
  });
});

describe("S3 before → after", () => {
  const verItem = (o: Partial<VersionsPayload["versions"][number]>) => ({ id: "v1", version: 1, status: "retired" as const, source: "system" as const, createdAt: "2026-11-07T10:00:00Z", approvedAt: "2026-11-07T11:00:00Z", approvedByName: "Manish", suggestedBy: null, changeCount: 0, takenCount: 0, summary: null, ...o });
  const base = (compare: VersionsPayload["compare"], versions = [verItem({}), verItem({ id: "v2", version: 2, status: "live", source: "person", approvedAt: "2026-11-09T11:00:00Z", suggestedBy: "Manish", changeCount: 2, takenCount: 1 })], draft: VersionsPayload["draft"] = null) => ({
    process: { key: KEY, name: "New lead → first call", ownerName: "Manish Sah", canApprove: true }, versions, draft, compare, tz: "UTC",
  });
  let mseq = 0;
  const measure = (o: Record<string, unknown>) => ({ metric: `m${++mseq}`, label: "Called within 1 working hour", unit: "percent", better: "up", before: 16, after: 29, change: null, ready: false, minDays: 7, waitText: "after 7 days", ...o });
  const compare = (daysLive: number, measures: unknown[]) =>
    ({
      process: { key: KEY, name: "n" },
      previous: { versionId: "v1", version: 1, period: { from: "2026-10-10T11:00:00Z", to: "2026-11-09T11:00:00Z" } },
      current: { versionId: "v2", version: 2, status: "live", approvedAt: "2026-11-09T11:00:00Z", approvedByName: "Manish", period: { from: "2026-11-09T11:00:00Z", to: "2026-11-12T11:00:00Z" }, daysLive },
      measures,
      changes: [
        { id: "c1", title: "First contact: count in working hours", status: "taken", authorName: "Manish", authorKind: "person", createdAt: "x" },
        { id: "c2", title: "Call-back kept: new wording", status: "not_taken", authorName: "Manish", authorKind: "person", createdAt: "x" },
      ],
    }) as unknown as VersionsPayload["compare"];

  it("young: the notice, the waiting change column, the version strip, what changed", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/versions": () => json(base(compare(3, [measure({}), measure({ label: "New leads that reached Qualified", before: 65, after: null, minDays: 14, waitText: "needs 14 days (the step's own target)" })]))) });
    render(<VersionsPage processKey={KEY} versionId={null} tenantName="Admizz" />);
    expect(await screen.findByText("Before → after")).toBeTruthy();
    expect(screen.getByText("v2 has run for 3 days.")).toBeTruthy();
    expect(screen.getByText(/The change column fills in after 7 days/)).toBeTruthy();
    expect(screen.getByText("after 7 days")).toBeTruthy();
    expect(screen.getByText("needs 14 days (the step's own target)")).toBeTruthy();
    expect(screen.getByText(/v2 so far \(9 Nov – 12 Nov\)/)).toBeTruthy();
    expect(screen.getByText("v1 (10 Oct – 9 Nov)")).toBeTruthy();
    expect(screen.getByText("Called within 1 working hour")).toBeTruthy();
    expect(screen.getByText("What changed in v2")).toBeTruthy();
    expect(screen.getByText(/Suggested by Manish · approved by Manish · 9 Nov/)).toBeTruthy();
    expect(screen.getByText(/Not taken · suggested by Manish/)).toBeTruthy();
    expect(screen.getByText("How this is measured")).toBeTruthy();
    expect(screen.getByText(/v2 · live since 9 Nov 2026/)).toBeTruthy();
  });

  it("under a full day: never says 'today'; first numbers after its first full day", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/versions": () => json(base(compare(0, [measure({ after: null })]))) });
    render(<VersionsPage processKey={KEY} versionId={null} tenantName="Admizz" />);
    expect(await screen.findByText("v2 went live less than a day ago.")).toBeTruthy();
    expect(screen.getByText(/First numbers after its first full day/)).toBeTruthy();
    expect(screen.queryByText(/today|yesterday|tomorrow/i)).toBeNull();
  });

  it("ready: the change is signed and coloured by direction", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/versions": () => json(base(compare(10, [measure({ ready: true, change: 13, waitText: "" }), measure({ label: "Wait for an owner (median)", unit: "min", better: "down", before: 120, after: 90, change: -25, ready: true, waitText: "" })]))) });
    render(<VersionsPage processKey={KEY} versionId={null} tenantName="Admizz" />);
    const up = await screen.findByText("+13 pts");
    expect(up.className).toContain("text-ds-good");
    expect(screen.getByText("−25%").className).toContain("text-ds-good");
    expect(screen.queryByText(/has run for/)).toBeNull();
  });

  it("only v1: says before → after starts when v2 goes live, and links an open draft", async () => {
    mockFetch({
      "GET /api/v1/processes/new_lead_first_call/versions": () =>
        json(base({ process: { key: KEY, name: "n" }, previous: null, current: { versionId: "v1", version: 1, status: "live", approvedAt: "2026-11-07T11:00:00Z", approvedByName: "Manish", period: { from: "a", to: "b" }, daysLive: 1 }, measures: [], changes: [] } as unknown as VersionsPayload["compare"], [verItem({ status: "live" })], { id: "d2", version: 2, changeCount: 1, suggestedBy: "Manish", source: "person" })),
    });
    render(<VersionsPage processKey={KEY} versionId={null} tenantName="Admizz" />);
    expect(await screen.findByText("Before → after starts when v2 goes live.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Draft v2 is waiting for review/ }).getAttribute("href")).toBe("/processes/new_lead_first_call/draft");
    expect(screen.getByText("v2 · draft")).toBeTruthy();
  });

  it("passes ?version= to the API", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/versions?version=v2": () => json(base(null)) });
    render(<VersionsPage processKey={KEY} versionId="v2" tenantName="Admizz" />);
    await screen.findByText("Before → after");
    expect(calls[0].url).toBe("/api/v1/processes/new_lead_first_call/versions?version=v2");
  });
});

describe("S4 improvements", () => {
  const ev = (o: Partial<LogEvent>): LogEvent => ({ at: "2026-11-10T09:00:00Z", kind: "approved", processKey: KEY, processKeys: [KEY], processName: "New lead → first call", versionId: "v2", version: 2, text: "New lead → first call: v2 live", meta: "1 change", actor: "Manish", reason: null, beforeAfter: true, measures: null, ...o });
  const events: LogEvent[] = [
    ev({ at: "2026-12-09T09:00:00Z", kind: "thirty_days", text: "New lead → first call: v2, 30 days on", meta: "Same measures as v1", measures: [
      { metric: "a", label: "Called within 1 working hour", unit: "percent", better: "up", before: 16, after: 58, change: 42, ready: true, minDays: 7, waitText: "" },
      { metric: "b", label: "Call-backs", unit: "percent", better: "up", before: 8, after: 9, change: 1, ready: true, minDays: 7, waitText: "" },
    ] }),
    ev({ at: "2026-11-10T09:00:00Z", kind: "rejected", processKey: "visa_to_enrolled", processKeys: ["visa_to_enrolled"], text: "Visa → Enrolled: draft v2 rejected", meta: 'Rejected by Manish · "Test first."', beforeAfter: false }),
    ev({ at: "2026-11-09T09:00:00Z" }),
  ];
  it("groups by day, shows the buttons and the coloured '30 days on' chips, and filters by process", async () => {
    mockFetch({ "GET /api/v1/processes/improvements": () => json({ events, tz: "UTC" }) });
    render(<ImprovementsPage />);
    expect(await screen.findByText("9 December 2026")).toBeTruthy();
    expect(screen.getByText("10 November 2026")).toBeTruthy();
    expect(screen.getByText("9 November 2026")).toBeTruthy();
    const good = screen.getByText(/Called within 1 working hour 16% → 58%/);
    expect(good.className).toContain("text-ds-good");
    expect(screen.getByText(/Call-backs 8% → 9%/).className).toContain("text-ds-good"); // up is better, even by 1 point
    expect(screen.getAllByRole("link", { name: "Before → after" })[0].getAttribute("href")).toBe("/processes/new_lead_first_call/versions?version=v2");
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/processes/visa_to_enrolled");
    fireEvent.click(screen.getByRole("radio", { name: "Visa" }));
    await waitFor(() => expect(screen.queryByText("9 December 2026")).toBeNull());
    expect(screen.getByText("Visa → Enrolled: draft v2 rejected")).toBeTruthy();
  });
});
