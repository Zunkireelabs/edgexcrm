// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
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
    nextStageByLead: {}, nextUp: null, firstCalls,
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
});
