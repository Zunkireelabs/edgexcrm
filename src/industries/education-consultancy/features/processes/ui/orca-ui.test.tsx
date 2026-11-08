// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { push, toast } = vi.hoisted(() => ({ push: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("sonner", () => ({ toast }));

import { buildBaselineSpec } from "../lib/baseline";
import { ADMIZZ_NEW_LEAD_RAW, ADMIZZ_SETUP } from "../lib/fixtures";
import { buildStepViews, buildTrigger, type ProcessView } from "../server/load-processes";
import type { ChangeView, DraftView } from "../server/changes";
import type { VersionsPage as VersionsPayload } from "../server/compare";
import { DraftReview } from "./draft-review";
import { ProcessDetail } from "./process-detail";
import { ProcessesPage } from "./processes-page";
import { VersionsPage } from "./versions-page";

const KEY = "new_lead_first_call" as const;
const spec = buildBaselineSpec(KEY, ADMIZZ_SETUP);

type D = NonNullable<ProcessView["draft"]>;
const ORCA: Pick<D, "source" | "summary" | "orca"> = { source: "agent", summary: "Steps 2 and 3 are red; most delay is before an owner is named.", orca: { arrived: 131, skipped: [{ step: "call_back", reason: "Rota-driven." }] } };
const PERSON: Pick<D, "source" | "summary" | "orca"> = { source: "person", summary: null, orca: null };
const draft = (over: Partial<D> = {}): D => ({ id: "d3", version: 3, changeCount: 2, ...ORCA, ...over }) as D;

const processView = (d: ProcessView["draft"]): ProcessView => {
  const steps = buildStepViews(KEY, spec, ADMIZZ_NEW_LEAD_RAW);
  return {
    key: KEY, name: "New lead → first call", processId: "p1", ownerUserId: "u1", ownerName: "Manish Sah", reviewDueAt: null, createdAt: "2026-11-07T10:00:00Z",
    shown: { id: "v2", version: 2, status: "live", source: "person", approvedAt: "2026-11-07T11:00:00Z", changeSummary: null },
    headline: steps[1], headlineStyle: "percent", headlineLabel: "contacted within 1 hour", summary: "s", trigger: buildTrigger(KEY, ADMIZZ_NEW_LEAD_RAW),
    drivesSummary: "Home rules", stepOwners: [], drives: [], rules: null, rulesFooter: "", steps, spec, specError: null, canApprove: true, draft: d,
  };
};

const json = (data: unknown, ok = true, status = 200) => Promise.resolve({ ok, status, json: async () => (ok ? { data } : { error: { message: String(data) } }) } as Response);
let calls: Array<{ url: string; method: string }> = [];
function mockFetch(routes: Record<string, () => Promise<Response>>) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    const hit = Object.keys(routes).find((k) => `${init?.method ?? "GET"} ${url}`.startsWith(k));
    return hit ? routes[hit]() : json("no route", false, 404);
  }));
}
beforeEach(() => { push.mockClear(); toast.success.mockClear(); toast.error.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("P1 · list: the Orca draft chip, the drafts-waiting row, the follows card", () => {
  const list = (d: ProcessView["draft"]) => ({ windowDays: 30, baselinesCreated: [], processes: [processView(d)], improvements: [], tz: "UTC" });
  const open = async (d: ProcessView["draft"]) => {
    mockFetch({ "GET /api/v1/processes": () => json(list(d)) });
    render(<ProcessesPage tenantName="Admizz" />);
    await screen.findByText("EdgeX improvements");
  };

  it("an Orca draft: 'Draft v3 from Orca' chip, 'Review draft', and '1 draft waiting for you · Orca, from 30 days of data'", async () => {
    await open(draft());
    expect(screen.getByText(/Draft v3 from Orca · 2 changes/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review draft" }).getAttribute("href")).toBe("/processes/new_lead_first_call/draft");
    const row = screen.getByTestId("orca-drafts-waiting");
    expect(within(row).getByText("1 draft waiting for you")).toBeTruthy();
    expect(within(row).getByText("Orca, from 30 days of data")).toBeTruthy();
  });
  it("a person's draft keeps its own chip and no Orca row", async () => {
    await open(draft({ ...PERSON }));
    expect(screen.getByText("Draft v3 · 2 changes")).toBeTruthy();
    expect(screen.queryByText(/from Orca/)).toBeNull();
    expect(screen.queryByTestId("orca-drafts-waiting")).toBeNull();
  });
  it("no draft: neither the chip nor the row", async () => {
    await open(null);
    expect(screen.queryByText(/from Orca/)).toBeNull();
    expect(screen.queryByTestId("orca-drafts-waiting")).toBeNull();
  });
  it("the 'Orca follows these' card is always there, with the drawn text", async () => {
    await open(null);
    const card = screen.getByTestId("orca-follows");
    expect(within(card).getByText("Orca follows these")).toBeTruthy();
    expect(card.textContent).toContain("reads the live version of that lead's process, and nothing else. It never changes a process; it can only suggest a draft.");
  });
});

describe("P2 · the banner above the map", () => {
  const detail = (d: ProcessView["draft"]) => ({ windowDays: 30, process: processView(d), versions: [], positions: [], tz: "UTC" });
  const open = async (d: ProcessView["draft"]) => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call": () => json(detail(d)) });
    render(<ProcessDetail processKey={KEY} tenantName="Admizz" />);
    await screen.findByText("Map and numbers");
  };

  it("an open Orca draft: 'Orca suggests 2 changes for v3 · from 131 new leads in 30 days', its summary and 'Review draft v3'", async () => {
    await open(draft());
    const b = screen.getByTestId("orca-banner");
    expect(within(b).getByText("Orca suggests 2 changes for v3")).toBeTruthy();
    expect(within(b).getByText("from 131 new leads in 30 days")).toBeTruthy();
    expect(within(b).getByText(/most delay is before an owner is named/)).toBeTruthy();
    expect(within(b).getByRole("link", { name: "Review draft v3" }).getAttribute("href")).toBe("/processes/new_lead_first_call/draft");
  });
  it("never without an open Orca draft: a person's draft or no draft shows no banner", async () => {
    await open(draft({ ...PERSON }));
    expect(screen.queryByTestId("orca-banner")).toBeNull();
    cleanup();
    await open(null);
    expect(screen.queryByTestId("orca-banner")).toBeNull();
  });
  it("a banner without the run's lead count just leaves that part out", async () => {
    await open(draft({ orca: { arrived: null, skipped: [] } }));
    expect(screen.getByText("Orca suggests 2 changes for v3")).toBeTruthy();
    expect(screen.queryByText(/new leads in/)).toBeNull();
  });
  it("'Not changed' lines: the step's name and the reason, at most 2 shown, the rest behind '+N more'", async () => {
    const skipped = [{ step: "call_back", reason: "Rota-driven." }, { step: "decide", reason: "Waits on the owner." }, { step: "assign", reason: "Fine by hand." }, { step: "first_contact", reason: "Already changed." }];
    await open(draft({ orca: { arrived: 131, skipped } }));
    const box = screen.getByTestId("orca-not-changed");
    const title = (k: string) => spec.steps.find((s) => s.key === k)!.title;
    expect(within(box).getAllByRole("listitem")).toHaveLength(2);
    expect(box.textContent).toContain(`Not changed: ${title("call_back")}: Rota-driven.`);
    expect(box.textContent).toContain(`Not changed: ${title("decide")}: Waits on the owner.`);
    expect(box.textContent).not.toContain("Fine by hand.");
    const more = within(box).getByRole("button", { name: /\+2 more/ });
    fireEvent.click(more);
    expect(within(box).getAllByRole("listitem")).toHaveLength(4);
    expect(box.textContent).toContain("Fine by hand.");
    fireEvent.click(within(box).getByRole("button", { name: "Show less" }));
    expect(within(box).getAllByRole("listitem")).toHaveLength(2);
  });
  it("one or two skipped steps need no toggle; none shows no block", async () => {
    await open(draft({ orca: { arrived: 131, skipped: [{ step: "call_back", reason: "Rota-driven." }] } }));
    expect(within(screen.getByTestId("orca-not-changed")).queryByRole("button")).toBeNull();
    cleanup();
    await open(draft({ orca: { arrived: 131, skipped: [] } }));
    expect(screen.queryByTestId("orca-not-changed")).toBeNull();
  });
});

describe("P3 · review: Proposed by Orca, the Why row, the badges, the footer", () => {
  const change = (o: Partial<ChangeView> = {}): ChangeView => ({
    id: "c1", part: "step:first_contact", field: "target", title: "First contact: count in working hours", stepKey: "first_contact",
    before: { value: 80, metric: "first_contact_1h_pct" }, after: { value: 80, metric: "first_contact_1wh_pct" },
    beforeText: "within 1 hour · target 80%", afterText: "within 1 working hour · target 80%",
    why: "Only 17% (22 of 131) were called within the hour, and 17 of 131 arrived on a Saturday.",
    evidence: [
      { metric: "step.first_contact.value", label: "First contact: called within 1 hour", value: "17% (22 of 131)", stepKey: "first_contact", href: null },
      { metric: "by_weekday.6.size", label: "Saturday: new leads", value: "17 of 131", stepKey: null, href: "/leads?f=sat" },
    ],
    authorKind: "agent", authorUserId: null, authorName: "Orca", status: "open", taken: true, editedByName: null, editedAt: null, createdAt: "2026-11-08T00:00:00Z",
    drives: "Home: new lead not called uses the new target", needs: null, turnsOn: null, ...o,
  });
  const view = (changes: ChangeView[], d: Partial<DraftView["draft"] & object> = {}): DraftView => ({
    process: { key: KEY, name: "New lead → first call", processId: "p1", ownerUserId: "u1", ownerName: "Manish Sah", canApprove: true },
    viewerName: "Manish", positions: [], live: { id: "v2", version: 2, approvedAt: "2026-11-07T00:00:00Z" },
    stepTitles: { call_back: "Call-backs", decide: "Decide" },
    draft: { id: "d3", version: 3, createdAt: "2026-11-08T00:00:00Z", isBaseline: false, authors: [{ userId: null, kind: "agent", name: "Orca" }], changes, ...ORCA, ...d },
  });
  const open = async (v: DraftView) => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/draft": () => json(v) });
    render(<DraftReview processKey={KEY} />);
    await screen.findByText("Review draft v3");
  };

  it("title badge 'Proposed by Orca' and the footer 'Approved by Manish · proposed by Orca'", async () => {
    await open(view([change()]));
    expect(screen.getByText("Proposed by Orca")).toBeTruthy();
    expect(screen.queryByText(/Suggested by/)).toBeNull();
    expect(screen.getByText(/Approved by Manish · proposed by Orca/)).toBeTruthy();
  });
  it("a person's draft is unchanged: 'Suggested by', the old Why line, no Orca chrome", async () => {
    await open(view([change({ authorKind: "person", authorName: "Manish", authorUserId: "u1", why: "Almost half arrive after 6 pm.", evidence: [] })], { ...PERSON, authors: [{ userId: "u1", kind: "person", name: "Manish" }] }));
    expect(screen.getByText("Suggested by Manish")).toBeTruthy();
    expect(screen.queryByText("Proposed by Orca")).toBeNull();
    expect(screen.queryByTestId("orca-why")).toBeNull();
    expect(screen.getByText(/Manish: “Almost half arrive after 6 pm\.”/)).toBeTruthy();
    expect(screen.getByText(/suggested by Manish/)).toBeTruthy();
  });
  it("the Why row: numbers in bold; a number with a link is that link; evidence WITHOUT an href is plain bold text, never a dead link", async () => {
    await open(view([change()]));
    const why = screen.getByTestId("orca-why");
    const sat = within(why).getByRole("link", { name: "17 of 131" });
    expect(sat.getAttribute("href")).toBe("/leads?f=sat");
    expect(sat.tagName).toBe("A");
    // the href-less value is bold text in the sentence, and not a link anywhere
    const bold = within(why).getAllByText("17% (22 of 131)", { exact: false }).concat(within(why).queryAllByText("17%"));
    expect(bold.length).toBeGreaterThan(0);
    expect(within(why).getAllByRole("link")).toHaveLength(1);
    expect(why.querySelectorAll("a[href='']").length).toBe(0);
    expect(why.querySelector("b")).toBeTruthy();
  });
  it("evidence the sentence doesn't quote still shows, bold; linked only when it has an href", async () => {
    await open(view([change({ why: "Saturday leads wait.", evidence: [{ metric: "a", label: "never contacted", value: "17 of 17", stepKey: null, href: null }, { metric: "b", label: "Saturday: new leads", value: "17 of 131", stepKey: null, href: "/leads?f=sat" }] })]));
    const why = screen.getByTestId("orca-why");
    expect(within(why).getByText("17 of 17").tagName).toBe("B");
    expect(within(why).queryByRole("link", { name: /17 of 17/ })).toBeNull();
    expect(within(why).getByRole("link", { name: /17 of 131/ }).getAttribute("href")).toBe("/leads?f=sat");
  });
  it("the needs badge and the 'Turns on: Settings → Smart assignment → Shadow' link (to the Lead Management settings)", async () => {
    await open(view([change({ needs: "EDGEX-104", turnsOn: "smart_assignment_shadow" })]));
    expect(screen.getByText("needs per-lead SMS · EDGEX-104")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Settings → Smart assignment → Shadow" });
    expect(link.getAttribute("href")).toBe("?settings=lead-management");
    expect(screen.getByTestId("turns-on").textContent).toContain("Turns on:");
  });
  it("no badge and no turns-on line when the change has neither", async () => {
    await open(view([change()]));
    expect(screen.queryByText(/needs /)).toBeNull();
    expect(screen.queryByTestId("turns-on")).toBeNull();
  });
  it("Orca's 'Not changed' lines sit above the changes (names from the live steps)", async () => {
    await open(view([change()], { orca: { arrived: 131, skipped: [{ step: "call_back", reason: "Rota-driven." }] } }));
    expect(screen.getByTestId("orca-not-changed").textContent).toContain("Not changed: Call-backs: Rota-driven.");
  });
});

describe("P4 · Orca's read on the versions page", () => {
  const payload = (orcaRead: unknown, draftSource: "agent" | "person" | null = "agent") => ({
    process: { key: KEY, name: "New lead → first call", ownerName: "Manish Sah", canApprove: true },
    versions: [{ id: "v2", version: 2, status: "live", source: "person", createdAt: "2026-11-09T10:00:00Z", approvedAt: "2026-11-09T11:00:00Z", approvedByName: "Manish", suggestedBy: "Orca", changeCount: 2, takenCount: 2, summary: null }],
    draft: draftSource ? { id: "d3", version: 3, changeCount: 1, suggestedBy: draftSource === "agent" ? "Orca" : "Asha", source: draftSource } : null,
    orcaRead,
    compare: null,
    tz: "UTC",
  } as unknown as VersionsPayload & { tz: string });
  const READ = { id: "o1", versionId: "v2", version: 2, summary: "Calls within the hour went from 17% to 30%.", generatedAt: "2026-11-18T00:00:00Z", nextDraft: { id: "d3", version: 3 } };
  const open = async (p: unknown) => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/versions": () => json(p), "POST /api/v1/processes/new_lead_first_call/versions/v2/read/dismiss": () => json({ dismissed: true }) });
    render(<VersionsPage processKey={KEY} versionId={null} tenantName="Admizz" />);
    await screen.findByText("Before → after");
  };

  it("shows the read with 'Open draft v3' (to the review page) and Dismiss", async () => {
    await open(payload(READ));
    const card = screen.getByTestId("orca-read");
    expect(within(card).getByText("Orca's read on v2")).toBeTruthy();
    expect(within(card).getByText("Calls within the hour went from 17% to 30%.")).toBeTruthy();
    expect(within(card).getByRole("link", { name: /Open draft v3/ }).getAttribute("href")).toBe("/processes/new_lead_first_call/draft");
    expect(within(card).getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });
  it("no 'Open draft' when Orca has no next draft", async () => {
    await open(payload({ ...READ, nextDraft: null }, null));
    expect(within(screen.getByTestId("orca-read")).queryByRole("link")).toBeNull();
  });
  it("Dismiss calls the dismiss route and hides the card", async () => {
    await open(payload(READ));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByTestId("orca-read")).toBeNull());
    expect(calls.some((c) => c.method === "POST" && c.url === "/api/v1/processes/new_lead_first_call/versions/v2/read/dismiss")).toBe(true);
  });
  it("a failed dismiss keeps the card and says so", async () => {
    mockFetch({ "GET /api/v1/processes/new_lead_first_call/versions": () => json(payload(READ)), "POST /api/v1/processes/new_lead_first_call/versions/v2/read/dismiss": () => json("nope", false, 500) });
    render(<VersionsPage processKey={KEY} versionId={null} tenantName="Admizz" />);
    await screen.findByText("Before → after");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByTestId("orca-read")).toBeTruthy();
  });
  it("no read in the payload (dismissed, or the version is under 7 days) shows no card", async () => {
    await open(payload(null));
    expect(screen.queryByTestId("orca-read")).toBeNull();
    expect(screen.queryByText(/Orca's read/)).toBeNull();
  });
});
