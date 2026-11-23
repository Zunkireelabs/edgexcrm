// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AIAssistantProvider } from "@/contexts/ai-assistant-context";
import type { ManagerData } from "../server/load-manager";
import { ManagerHome } from "./manager-home";
import { OrcaReadCard } from "./orca-read";

afterEach(cleanup);
const css = readFileSync(resolve(__dirname, "home.css"), "utf8");
/** The text of the media / container block that starts at `head` (from its `{` to the matching `}`). */
function block(head: string): string {
  const at = css.lastIndexOf(head);
  expect(at).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  return "";
}

const own = { doNext: { items: [], total: 0 }, nextStageByLead: {}, aiOn: false, canAskOrca: false, week: [], agenda: [], read: null };
const base = (over: Record<string, unknown> = {}) =>
  ({
    tz: "Asia/Kathmandu", greeting: "Good morning, Manish", lede: "x", dateShort: "Tue 10 Nov", needsYou: [], needsALook: { rows: [], others: 2 }, canOpenPulse: true, canSetLaunch: true,
    own, leaveWaiting: 0, branchName: null, shortName: "Admizz", read: null, impact: { status: "unset", since: null, readyOn: null, afterDays: 0, rows: [] },
    shadow: { total: 0, matched: 0, pct: 0 }, rules: { href: null, rows: [{ label: "First contact", value: "1 hour" }], footer: "f" }, ...over,
  }) as unknown as ManagerData;
const agentRow = { key: "agent_drafts", tone: "neutral", icon: "sparkle", title: "3 drafts from Orca to approve", chip: { text: "Follow-up agent", tone: "neutral" }, why: "w", actions: [{ type: "link", label: "Review 3", href: "/orca/review" }] };
const userRow = { key: "at_risk:gautam", tone: "bad", icon: "trend-down", title: "Gautam Basnet: 120 leads untouched", chip: { text: "Activity −82%", tone: "bad" }, why: "Moves nothing forward · Kamal 557", actions: [{ type: "nudge", label: "Nudge Gautam", userId: "g", userName: "Gautam" }, { type: "link", label: "Open in Pulse", href: "/pulse" }] };

describe("Q6: the drafts row icon is violet", () => {
  it("the sparkle row gets the ai tint; other rows keep their tone", () => {
    const { container } = render(<ManagerHome data={base({ needsYou: [agentRow, userRow] })} />);
    const icons = [...container.querySelectorAll("#need-agent_drafts .eh-ic, #need-at_risk\\:gautam .eh-ic")].map((e) => e.className);
    expect(icons).toEqual(["eh-ic ai", "eh-ic bad"]);
    expect(css).toMatch(/\.eh-ic\.ai \{[^}]*soft\)[^}]*line\)[^}]*color: var/);
  });
});

describe("Q5 / Q5b: Needs you rows never cut a title, chip or why line", () => {
  it("the list is the container, and the row keeps its chip and why in the DOM", () => {
    const { container } = render(<ManagerHome data={base({ needsYou: [userRow] })} />);
    expect(container.querySelector(".eh-list.eh-list-needs #need-at_risk\\:gautam .eh-tl .eh-chip")?.textContent).toBe("Activity −82%");
  });
  it("css: a chip never shrinks; the title and the why line wrap; the buttons drop under the text when the column is narrow", () => {
    expect(css).toMatch(/\.eh-list-needs \.eh-tl > \.eh-chip \{ flex: 0 0 auto; max-width: none; overflow: visible; text-overflow: clip; \}/);
    expect(css).toMatch(/\.eh-list-needs \.eh-tl > \.eh-nm \{[^}]*white-space: normal;[^}]*overflow: visible;/);
    expect(css).toMatch(/\.eh-list-needs \.eh-wh, \.eh-list-needs \.eh-wh\.eh-wh-wrap \{ white-space: normal;[^}]*-webkit-line-clamp: unset;/);
    expect(css).toMatch(/\.eh-list-needs \{ container-type: inline-size; \}/);
    expect(block("@container (max-width: 700px)")).toContain("grid-column: 2 / -1");
  });
  it("css: the ellipsis rules of the shared row do not reach the Needs-you list", () => {
    // The shared row cuts with "..." (.eh-wh, .eh-chip); every one of those properties is overridden for .eh-list-needs.
    expect(css).toMatch(/\.eh-tl > \.eh-chip \{ flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/);
    expect(css.indexOf(".eh-list-needs .eh-tl > .eh-chip")).toBeGreaterThan(css.indexOf(".eh-tl > .eh-chip { flex: 0 1 auto"));
  });
});

describe("Q8: a phone owner / branch manager still sees Needs a look and Is the new Home helping?", () => {
  it("the aside is the manager one; only the rules and smart-assignment cards are phone-hidden", () => {
    const { container } = render(<ManagerHome data={base()} />);
    const aside = container.querySelector("aside.eh-side");
    expect(aside?.classList.contains("eh-side-mgr")).toBe(true);
    expect(container.querySelector("#look")?.classList.contains("eh-ph-hide")).toBe(false);
    expect(container.querySelector("#impact")?.classList.contains("eh-ph-hide")).toBe(false);
    expect([...container.querySelectorAll(".eh-ph-hide h3")].map((h) => h.textContent)).toEqual(["Smart assignment", "Rules from your processes"]);
    // Needs a look comes first, the helping card last.
    const order = [...aside!.querySelectorAll("h3")].map((h) => h.textContent);
    expect(order[0]).toBe("Needs a look");
    expect(order[order.length - 1]).toBe("Is the new Home helping?");
  });
  it("css: under 768px the manager column is shown, every other .eh-side stays hidden (the counsellor's phone, H7, is unchanged)", () => {
    expect(block("@media (max-width: 767px) {\n  .eh-side.eh-side-mgr")).toMatch(/\.eh-side\.eh-side-mgr \{ display: block; \}[\s\S]*\.eh-side-mgr \.eh-ph-hide \{ display: none; \}/);
    expect(css).toMatch(/\.eh-side \{ display: none; \}/); // the counsellor rule is untouched
  });
});

describe("Q7: the subtitle says how long", () => {
  it("under 3 weeks: 'First 9 days'; from 3 weeks: 'Last 3 weeks'", () => {
    const impact = (afterDays: number) => ({ status: "ready", since: "1 Nov", readyOn: null, afterDays, rows: [] });
    render(<ManagerHome data={base({ impact: impact(9) })} />);
    expect(screen.getByText("First 9 days vs the 4 weeks before it went live")).toBeTruthy();
    cleanup();
    render(<ManagerHome data={base({ impact: impact(21) })} />);
    expect(screen.getByText("Last 3 weeks vs the 4 weeks before it went live")).toBeTruthy();
  });
});

describe("Q4: Orca's read on a phone", () => {
  const READ = { points: [{ claim: "Reassign 120", reason: "r", factIds: ["a"], link: { href: "/home#need-a", label: "Reassign 120 · split across 3 Counsellors →" } }], madeAt: "2026-11-09T01:15:00.000Z", refreshes: 0, feedback: null };
  it("the title is its own element, so the header can be two lines (title + icons, then 'made at')", () => {
    const { container } = render(<AIAssistantProvider><OrcaReadCard scope="business" initial={READ} tz="Asia/Kathmandu" title="Orca's read on KTM" canAsk={false} /></AIAssistantProvider>);
    expect(container.querySelector(".eh-orca-h > .ti")?.textContent).toBe("Orca's read on KTM");
    expect(container.querySelector(".eh-orca-h > .mt")?.textContent).toContain("made at");
    expect(container.querySelector(".eh-orca-h > .act")).not.toBeNull();
  });
  it("css: below 768px the header wraps with 'made at' on its own line, and the link wraps like text", () => {
    const b = block("@media (max-width: 767px) {\n  .eh-orca-h { flex-wrap: wrap");
    expect(b).toMatch(/\.eh-orca-h \.mt \{ order: 3; flex: 0 0 100%;/);
    expect(b).toMatch(/\.eh-orca-h \.act \{ order: 2; \}/);
    expect(b).toMatch(/\.eh-orca-pts \.lk \{ white-space: normal; \}/);
    expect(css).toMatch(/\.eh-orca-pts li > span:last-child \{ min-width: 0; overflow-wrap: anywhere; \}/);
  });
});
