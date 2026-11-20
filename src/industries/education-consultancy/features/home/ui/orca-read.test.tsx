// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { AIAssistantProvider } from "@/contexts/ai-assistant-context";
import { OrcaReadCard } from "./orca-read";
import type { StoredRead } from "../server/stored-read";

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { ai: true } }) })));
});

const READ: StoredRead = {
  points: [
    { claim: "Open the 52 missed call-backs", reason: "They are the oldest.", factIds: ["item:missed_callbacks:all"], link: { href: "/home?open=missed_callbacks%3Aall", label: "Open 52 →" } },
    { claim: "Your calls are down", reason: "46 against 52 usual.", factIds: ["week:calls"], link: { href: "/home#week", label: "See why →" } },
  ],
  madeAt: "2026-11-09T01:15:00.000Z",
  refreshes: 0,
  feedback: null,
};
const renderCard = (canAsk: boolean) => render(<AIAssistantProvider><OrcaReadCard scope="me" initial={READ} tz="Asia/Kathmandu" title="Orca's read on your day" canAsk={canAsk} /></AIAssistantProvider>);

describe("OrcaReadCard", () => {
  it("R3: a person who can't open Ask Orca sees no Ask box and no chips (they would do nothing)", () => {
    renderCard(false);
    expect(screen.queryByLabelText("Ask Orca")).toBeNull();
    expect(screen.queryByText("Who should I call first?")).toBeNull();
  });
  it("R3: an owner sees the Ask box and the two chips", () => {
    renderCard(true);
    expect(screen.getByLabelText("Ask Orca")).toBeTruthy();
    expect(screen.getByText("Who should I call first?")).toBeTruthy();
    expect(screen.getByText("What did I miss this week?")).toBeTruthy();
  });
  it("R7: numbered 1-2, and every link comes from the fact (never a bare /leads)", () => {
    const { container } = renderCard(false);
    expect([...container.querySelectorAll(".eh-orca-pts .n")].map((n) => n.textContent)).toEqual(["1", "2"]);
    const hrefs = [...container.querySelectorAll(".eh-orca-pts a")].map((a) => [a.getAttribute("href"), a.textContent]);
    expect(hrefs).toEqual([["/home?open=missed_callbacks%3Aall", "Open 52 →"], ["/home#week", "See why →"]]);
  });
  it("the header names the real time it was made and what it was made from", () => {
    renderCard(false);
    expect(screen.getByText(/made at 7:00 am from your leads, calls and tasks/)).toBeTruthy();
  });
});
