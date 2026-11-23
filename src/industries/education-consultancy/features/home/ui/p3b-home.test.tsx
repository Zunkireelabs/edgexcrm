// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: nav.replace }), useSearchParams: () => new URLSearchParams(nav.search) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { buildDoNext } from "../lib/build";
import { lead } from "../lib/fixtures";
import type { HomePolicy } from "../lib/rules/ctx";
import { buildRulesCard } from "../lib/rules-card";
import { defaultPolicy, derivePolicy } from "../../processes/lib/policy";
import { buildBaselineSpec } from "../../processes/lib/baseline";
import { ADMIZZ_SETUP } from "../../processes/lib/fixtures";
import type { HomeData } from "../server/load-page";
import type { ManagerData } from "../server/load-manager";
import { EducationHome } from "./home-page";
import { ManagerHome } from "./manager-home";

afterEach(cleanup);

const OH = { days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, source: "saved" as const };
const POLICY: HomePolicy = { live: true, firstContact: { minutes: 60, clock: "working" }, officeHours: OH, unreachableAfterCalls: 3 };
const NOW = new Date("2026-11-08T05:20:00.000Z");

function homeData(firstCalls: HomeData["firstCalls"]): HomeData {
  const doNext = buildDoNext(
    { userId: "u1", leads: [lead({ id: "l-b", name: "Bikash Gurung", assignedAt: "2026-11-07T14:25:00.000Z", createdAt: "2026-11-07T14:25:00.000Z" })], conversations: [], tasks: [], applications: [], submitStageByPipeline: new Map(), medianDwellDays: new Map(), snoozedKeys: new Set() },
    { now: NOW, tz: "Asia/Kathmandu", policy: POLICY },
  );
  return {
    tz: "Asia/Kathmandu", greeting: "Good morning, Kamana", lede: "Sunday 8 November", dateShort: "Sun 8 Nov", doNext, agenda: [],
    week: [{ key: "first_hour", label: "New leads called within 1 working hour", value: "0 of 3", note: null, tone: "neutral" }],
    nextStageByLead: {}, nextUp: null, aiOn: false, canAskOrca: false, read: null, firstCalls,
  };
}

describe("T1 counsellor Home", () => {
  it("shows the late chip and the 'First calls count in working hours' header text, with the link for owner/admin", () => {
    render(<EducationHome data={homeData({ working: true, processHref: "/processes/new_lead_first_call" })} />);
    expect(screen.getByText("Late · 1 h 5 min")).toBeTruthy();
    expect(screen.getByText(/arrived Sat 8:10 pm \(closed\) · due 10:00 am/)).toBeTruthy();
    expect(screen.getByText(/First calls count in working hours/)).toBeTruthy();
    expect(screen.getByText("New lead process").getAttribute("href")).toBe("/processes/new_lead_first_call");
    expect(screen.getByText("New leads called within 1 working hour")).toBeTruthy();
  });
  it("a counsellor sees the text without the link (they get 404 on /processes)", () => {
    render(<EducationHome data={homeData({ working: true, processHref: null })} />);
    expect(screen.getByText(/First calls count in working hours/).textContent).toContain("New lead process");
    expect(screen.queryByRole("link", { name: "New lead process" })).toBeNull();
  });
  it("a plain-clock process (or none) has no header text", () => {
    render(<EducationHome data={homeData({ working: false, processHref: null })} />);
    expect(screen.queryByText(/First calls count in working hours/)).toBeNull();
  });
});

describe("T2 owner Home: Rules from your processes", () => {
  const spec = buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
  spec.steps.find((s) => s.key === "first_contact")!.target = { metric: "first_contact_1wh_pct", op: ">=", value: 75, unit: "percent" };
  const managerData = (rules: ManagerData["rules"]): ManagerData =>
    ({
      tz: "Asia/Kathmandu", greeting: "Good morning, Manish", lede: "x", dateShort: "Sun 8 Nov", needsYou: [],
      needsALook: { rows: [], others: 0 }, canOpenPulse: true, impact: { status: "unset", since: null, rows: [] }, canSetLaunch: true,
      own: homeData({ working: true, processHref: "/processes/new_lead_first_call" }), leaveWaiting: 0, branchName: null, shadow: null, rules,
    }) as unknown as ManagerData;

  it("rows, the footer and the Open link", () => {
    const rules = buildRulesCard(derivePolicy({ version: 2, approvedAt: "2026-11-07T08:00:00Z", ownerName: "Manish", approvedByName: "Manish", spec }, OH), "off", "Asia/Kathmandu");
    render(<ManagerHome data={managerData(rules)} />);
    expect(screen.getByText("Rules from your processes")).toBeTruthy();
    expect(screen.getByText("5 min · by hand")).toBeTruthy();
    expect(screen.getByText("1 working hour")).toBeTruthy();
    expect(screen.getByText("Sun–Fri, 9–6")).toBeTruthy();
    expect(screen.getByText("From New lead → first call v2, approved by Manish on 7 Nov.")).toBeTruthy();
    expect(screen.getByText("Open").getAttribute("href")).toBe("/processes/new_lead_first_call");
  });
  it("no live process: today's defaults, no Open link", () => {
    render(<ManagerHome data={managerData(buildRulesCard(defaultPolicy(), "off", "Asia/Kathmandu"))} />);
    expect(screen.getByText("Today's defaults: no process is live yet.")).toBeTruthy();
    expect(screen.queryByText("Open")).toBeNull();
  });
  it("a branch manager (no rules card data) sees no card", () => {
    render(<ManagerHome data={managerData(null)} />);
    expect(screen.queryByText("Rules from your processes")).toBeNull();
  });
  it("an owner 'Needs you' row repeats its chip text in the phone-only eh-ph span before the why-line (EDGEX-109 P3b round 4)", () => {
    const data = {
      ...managerData(null),
      needsYou: [{ key: "unassigned", tone: "bad", icon: "user-plus", title: "Assign 9 new leads", chip: { text: "Waiting 11 days \u00B7 target 5 min", tone: "bad" }, why: "Oldest arrived 28 Oct.", actions: [] }],
    } as unknown as ManagerData;
    const { container } = render(<ManagerHome data={data} />);
    const ph = container.querySelector(".eh-wh .eh-ph");
    expect(ph?.textContent).toBe("Waiting 11 days \u00B7 target 5 min \u00B7 ");
    expect(ph?.parentElement?.textContent).toBe("Waiting 11 days \u00B7 target 5 min \u00B7 Oldest arrived 28 Oct.");
  });
});

describe("R1: Orca's read opens a grouped row's own sheet via /home?open=<key>, once", () => {
  const child = { key: "callback_overdue:l1", kind: "callback_overdue", tier: "now", leadId: "l1", title: "Sujan Rai", why: "", chip: { text: "2 days", tone: "bad" }, tone: "bad", primaryAction: { type: "call", leadId: "l1", phone: null, leadName: "Sujan Rai" }, sortKey: { group: 0, at: 0 }, evidenceHref: "/leads/l1" };
  const grouped = { key: "missed_callbacks:all", kind: "missed_callbacks", tier: "now", title: "1 missed call-back", why: "", chip: { text: "1", tone: "bad" }, tone: "bad", primaryAction: { type: "sheet", label: "Call through them" }, sortKey: { group: 9, at: 0 }, evidenceHref: "/leads", children: [child] };
  const data = () => {
    const base = homeData({ working: false, processHref: null });
    return { ...base, doNext: { ...base.doNext, items: [grouped] } } as unknown as HomeData;
  };
  it("the param opens that row's sheet and is cleared with router.replace", () => {
    nav.search = "open=missed_callbacks%3Aall";
    nav.replace.mockClear();
    render(<EducationHome data={data()} />);
    expect(screen.getByText(/Log each call and it drops off this list/)).toBeTruthy();
    expect(nav.replace).toHaveBeenCalledWith("/home", { scroll: false });
    nav.search = "";
  });
  it("no param: no sheet, nothing replaced", () => {
    nav.search = "";
    nav.replace.mockClear();
    render(<EducationHome data={data()} />);
    expect(screen.queryByText(/Log each call and it drops off this list/)).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });
  it("an unknown key opens nothing", () => {
    nav.search = "open=nope";
    render(<EducationHome data={data()} />);
    expect(screen.queryByText(/Log each call and it drops off this list/)).toBeNull();
    nav.search = "";
  });
});

describe("B6 on the owner Home", () => {
  const base = (over: Record<string, unknown>) => ({
    tz: "Asia/Kathmandu", greeting: "Good morning, Sadin", lede: "x", dateShort: "Tue 10 Nov", needsYou: [],
    needsALook: { rows: [], others: 0 }, canOpenPulse: true, canSetLaunch: true, own: homeData({ working: true, processHref: null }), leaveWaiting: 0,
    branchName: null, shortName: "Admizz", shadow: null, rules: null, read: null, impact: { status: "unset", since: null, readyOn: null, afterDays: 0, rows: [] }, ...over,
  }) as unknown as ManagerData;
  const agentRow = { key: "agent_drafts", tone: "neutral", icon: "sparkle", title: "3 drafts from Orca to approve", chip: { text: "Follow-up agent", tone: "neutral" }, why: "Written for all branches · nothing is sent until someone approves", actions: [{ type: "link", label: "Review 3", href: "/orca/review" }] };

  it("the Needs-you row: count, agent chip and 'Review 3' to the agent approvals page", () => {
    render(<ManagerHome data={base({ needsYou: [agentRow] })} />);
    expect(screen.getByText("3 drafts from Orca to approve")).toBeTruthy();
    expect(screen.getAllByText("Follow-up agent").length).toBeGreaterThan(0);
    expect(screen.getByText("Review 3").closest("a")?.getAttribute("href")).toBe("/orca/review");
  });
  it("with no drafts the row simply isn't there", () => {
    render(<ManagerHome data={base({ needsYou: [] })} />);
    expect(screen.queryByText(/drafts? from Orca to approve/)).toBeNull();
  });
  it("within 7 days of go-live the card says 'Ready on <date>', not numbers", () => {
    render(<ManagerHome data={base({ impact: { status: "measuring", since: "5 Nov", readyOn: "12 Nov", afterDays: 0, rows: [] } })} />);
    expect(screen.getByText(/Ready on 12 Nov\. Measuring since 5 Nov\./)).toBeTruthy();
  });
  it("no launch date: the existing 'Start measuring today' button stays", () => {
    render(<ManagerHome data={base({})} />);
    expect(screen.getByText("Start measuring today")).toBeTruthy();
  });
  it("ready: the four rows with the Orca drafts line, and the subtitle follows the real window", () => {
    const rows = [
      { key: "first_hour", label: "New leads contacted within 1 hour", value: "71%", was: "was 52%", tone: "good" },
      { key: "callbacks", label: "Call-backs done on the day booked", value: "84%", was: "was 61%", tone: "good" },
      { key: "deadlines", label: "Deadlines missed", value: "0", was: "was 3 in 4 weeks", tone: "good" },
      { key: "orca_drafts", label: "Orca drafts sent as written", value: "64%", was: "28% edited · 8% thrown away", tone: "neutral" },
    ];
    const { unmount } = render(<ManagerHome data={base({ impact: { status: "ready", since: "5 Nov", readyOn: null, afterDays: 21, rows } })} />);
    expect(screen.getByText("Last 3 weeks vs the 4 weeks before it went live")).toBeTruthy();
    expect(screen.getByText("Orca drafts sent as written")).toBeTruthy();
    expect(screen.getByText("64%")).toBeTruthy();
    expect(screen.getByText("28% edited · 8% thrown away")).toBeTruthy();
    unmount();
    render(<ManagerHome data={base({ impact: { status: "ready", since: "5 Nov", readyOn: null, afterDays: 14, rows } })} />);
    expect(screen.getByText("First 14 days vs the 4 weeks before it went live")).toBeTruthy();
  });
});
