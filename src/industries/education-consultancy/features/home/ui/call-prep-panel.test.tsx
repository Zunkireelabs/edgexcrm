// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import { CallPrepPanel } from "./call-prep-panel";
import type { DoNextItem } from "../lib/types";

afterEach(cleanup);

const ITEM = { key: "new_uncalled:L1", kind: "new_uncalled", tier: "now", leadId: "L1", title: "Sujan Rai", why: "", chip: { text: "New · 38 min", tone: "new" }, tone: "new", primaryAction: { type: "call", leadId: "L1", phone: "+9779841234412", leadName: "Sujan Rai" }, sortKey: { group: 0, at: 0 }, evidenceHref: "/leads/L1" } as unknown as DoNextItem;
const DATA = (o: Record<string, unknown> = {}) => ({
  ai: true, leadName: "Sujan Rai", firstName: "Sujan", chips: { source: "Facebook ad: Nursing in Australia", phone: "+977 98•• ••• 412" },
  known: [{ k: "Wants", v: "Bachelor of Nursing · Australia · Feb 2027" }, { k: "English test", v: "none on record" }],
  ask: [{ key: "budget", label: "Budget" }, { key: "decision_maker", label: "Who decides" }],
  opening: "Hi Sujan, this is Rita from Admizz.", kb: { text: "4 partner universities take nursing.", source: "Australia partners 2027.pdf", page: 3 }, ...o,
});
const stub = (data: unknown, ok = true) => vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ data }) })));

describe("CallPrepPanel", () => {
  it("shows what we know, the ask-about chips, the opening line and the knowledge-base box with file and page", async () => {
    stub(DATA());
    render(<CallPrepPanel key={ITEM.key} item={ITEM} onClose={() => {}} onCall={() => {}} />);
    await screen.findByText("Hi Sujan, this is Rita from Admizz.");
    expect(screen.getByText("Bachelor of Nursing · Australia · Feb 2027")).toBeTruthy();
    expect(screen.getByText("none on record")).toBeTruthy();
    expect(screen.getByText("Budget")).toBeTruthy();
    expect(screen.getByText("Who decides")).toBeTruthy();
    expect(screen.getByText("Australia partners 2027.pdf · p. 3")).toBeTruthy();
    expect(screen.getByText(/the two violet boxes are Orca's/)).toBeTruthy();
  });
  it("D4: no knowledge-base match, no knowledge-base box, and the note says one violet box", async () => {
    stub(DATA({ kb: null }));
    render(<CallPrepPanel key={ITEM.key} item={ITEM} onClose={() => {}} onCall={() => {}} />);
    await screen.findByText("Hi Sujan, this is Rita from Admizz.");
    expect(screen.queryByText("From your knowledge base")).toBeNull();
    expect(screen.getByText(/the violet box is Orca's/)).toBeTruthy();
    expect(screen.queryByText(/and your knowledge base/)).toBeNull();
  });
  it("shows the masked phone only: the full number is nowhere in the panel text", async () => {
    stub(DATA());
    const { container } = render(<CallPrepPanel key={ITEM.key} item={ITEM} onClose={() => {}} onCall={() => {}} />);
    await screen.findByText("+977 98•• ••• 412");
    expect(container.ownerDocument.body.textContent).not.toContain("9841234412");
  });
  it("the footer says one note fills the record, and 'Call Sujan' is the row's own call (tel:) then opens the log", async () => {
    stub(DATA());
    const onCall = vi.fn();
    render(<CallPrepPanel key={ITEM.key} item={ITEM} onClose={() => {}} onCall={onCall} />);
    await screen.findByText("Hi Sujan, this is Rita from Admizz.");
    expect(screen.getByText("After the call, one note fills in the record.")).toBeTruthy();
    const a = screen.getByLabelText("Call Sujan");
    expect(a.getAttribute("href")).toBe("tel:+9779841234412");
    fireEvent.click(a);
    expect(onCall).toHaveBeenCalledWith(ITEM);
  });
  it("nothing to ask about: no Ask-about section; a failed load still lets you call", async () => {
    stub(DATA({ ask: [] }));
    const { unmount } = render(<CallPrepPanel key={ITEM.key} item={ITEM} onClose={() => {}} onCall={() => {}} />);
    await screen.findByText("Hi Sujan, this is Rita from Admizz.");
    expect(screen.queryByText(/Ask about/)).toBeNull();
    unmount();
    stub(null, false);
    render(<CallPrepPanel key={ITEM.key} item={ITEM} onClose={() => {}} onCall={() => {}} />);
    await screen.findByText(/Couldn't load the prep just now/);
    expect(screen.getByLabelText("Call Sujan")).toBeTruthy();
  });
});
