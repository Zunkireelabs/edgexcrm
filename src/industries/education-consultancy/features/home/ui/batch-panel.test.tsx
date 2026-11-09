// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BatchPanel } from "./batch-panel";
import { PrepareAllCard } from "./prepare-all-card";
import type { BatchEntry } from "../lib/batch";

afterEach(cleanup);

const E = (id: string, name: string, kind: BatchEntry["kind"] = "going_quiet"): BatchEntry => ({ leadId: id, kind, name, label: "9 days quiet" });
const ENTRIES = [E("a", "Ramesh Adhikari"), E("b", "Dipa Lama"), E("c", "Saroj Karki"), E("d", "Mina Gurung")];
const card = (id: string, name: string, channel: "whatsapp" | "email" | null, draft: unknown = { id: `dr-${id}`, text: `Hi ${name.split(" ")[0]}, checking in.`, subject: channel === "email" ? "Checking in" : null, why: "w" }) => ({
  leadId: id, leadName: name, kind: "going_quiet", channels: channel ? [channel] : [], channel, phone: channel === "whatsapp" ? "+9779841234567" : null, email: channel === "email" ? { accountId: "acc", to: "m@x.com" } : null, draft,
});
let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
function stub(cards: unknown[]) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    calls.push({ url, body });
    if (url === "/api/v1/home/draft-batch") return { ok: true, status: 200, json: async () => ({ data: { ai: true, cards } }) };
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  }));
}
const openSpy = vi.fn();
beforeEach(() => { vi.stubGlobal("open", openSpy); openSpy.mockClear(); });
const mount = (onSent = () => {}) => render(<BatchPanel key="x" entries={ENTRIES} open onClose={() => {}} onSent={onSent} />);

describe("PrepareAllCard", () => {
  it("'Orca can prepare N of these' with the summary and the button; nothing for a single message", () => {
    const { rerender } = render(<PrepareAllCard entries={ENTRIES} total={4} onPrepare={() => {}} />);
    expect(screen.getByText("Orca can prepare 4 of these for you")).toBeTruthy();
    expect(screen.getByText(/4 check-ins\. You check each one before anything is sent\./)).toBeTruthy();
    expect(screen.getByText("Prepare all 4")).toBeTruthy();
    rerender(<PrepareAllCard entries={[ENTRIES[0]]} total={1} onPrepare={() => {}} />);
    expect(screen.queryByText(/Orca can prepare/)).toBeNull();
  });
  it("says so when more than 12 were found", () => {
    render(<PrepareAllCard entries={Array.from({ length: 12 }, (_, i) => E(`l${i}`, `L${i}`))} total={15} onPrepare={() => {}} />);
    expect(screen.getByText(/The first 12 now\./)).toBeTruthy();
  });
});

describe("BatchPanel", () => {
  it("every draft on one screen with its channel chip; failed cards say so and the others still show", async () => {
    stub([card("a", "Ramesh Adhikari", "whatsapp"), card("b", "Dipa Lama", "email"), card("c", "Saroj Karki", "whatsapp", null), card("d", "Mina Gurung", "whatsapp")]);
    mount();
    await screen.findByText("Hi Ramesh, checking in.");
    expect(screen.getByText("Hi Mina, checking in.")).toBeTruthy();
    expect(screen.getByText("Couldn't draft, write your own.")).toBeTruthy();
    expect(screen.getByText("Check before sending · 4 messages")).toBeTruthy();
    expect(screen.getAllByText("WhatsApp · 9 days quiet").length).toBe(3);
    expect(screen.getByText("Email · 9 days quiet")).toBeTruthy();
  });
  it("untick excludes: Send/Go-through counts follow the ticks, and an unticked one is never sent", async () => {
    stub([card("a", "Ramesh Adhikari", "whatsapp"), card("b", "Dipa Lama", "email"), card("d", "Mina Gurung", "email")]);
    mount();
    await screen.findByText("Hi Ramesh, checking in.");
    expect(screen.getByText("Send 2")).toBeTruthy();
    expect(screen.getByText("Go through 1")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Include Mina Gurung"));
    expect(screen.getByText("Send 1")).toBeTruthy();
    fireEvent.click(screen.getByText("Send 1"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/v1/email/send")).toBe(true));
    expect(calls.filter((c) => c.url === "/api/v1/email/send")).toHaveLength(1);
    expect(calls.find((c) => c.url === "/api/v1/email/send")?.body).toMatchObject({ lead_id: "b", to: ["m@x.com"], subject: "Checking in" });
  });
  it("Send N sends every ticked email together through /email/send and records each as sent", async () => {
    stub([card("b", "Dipa Lama", "email"), card("d", "Mina Gurung", "email")]);
    mount();
    await screen.findByText("Hi Dipa, checking in.");
    fireEvent.click(screen.getByText("Send 2"));
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/v1/home/draft-resolve" && c.body.action === "sent")).toHaveLength(2));
    expect(calls.filter((c) => c.url === "/api/v1/email/send").map((c) => c.body.lead_id)).toEqual(["b", "d"]);
  });
  it("Go through N: opens the FIRST in WhatsApp, asks 'Sent?', and No logs nothing; then moves to the next", async () => {
    stub([card("a", "Ramesh Adhikari", "whatsapp"), card("c", "Saroj Karki", "whatsapp")]);
    mount();
    await screen.findByText("Hi Ramesh, checking in.");
    fireEvent.click(screen.getByText("Go through 2"));
    await screen.findByText(/Sent\? Ramesh Adhikari \(1 of 2\)/);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0][0]).toBe("https://wa.me/9779841234567?text=Hi%20Ramesh%2C%20checking%20in.");
    fireEvent.click(screen.getByText("No"));
    await screen.findByText(/Next: Saroj Karki \(2 of 2\)/);
    const resolves = calls.filter((c) => c.url === "/api/v1/home/draft-resolve");
    expect(resolves.map((c) => c.body.action)).toEqual(["opened"]); // No = nothing logged on the timeline
  });
  it("Yes logs it as sent with the person's own edited text, then the next opens; nothing is typed twice", async () => {
    stub([card("a", "Ramesh Adhikari", "whatsapp"), card("c", "Saroj Karki", "whatsapp")]);
    const onSent = vi.fn();
    mount(onSent);
    await screen.findByText("Hi Ramesh, checking in.");
    fireEvent.click(screen.getAllByText("Edit")[0]);
    fireEvent.change(screen.getByLabelText("Message to Ramesh Adhikari"), { target: { value: "Hi Ramesh, my own words." } });
    fireEvent.click(screen.getByText("Go through 2"));
    fireEvent.click(await screen.findByText("Yes, I sent it"));
    await screen.findByText(/Next: Saroj Karki/);
    expect(openSpy.mock.calls[0][0]).toContain(encodeURIComponent("my own words."));
    expect(calls.find((c) => c.url === "/api/v1/home/draft-resolve" && c.body.action === "sent")?.body).toMatchObject({ draftId: "dr-a", channel: "whatsapp", finalText: "Hi Ramesh, my own words." });
    fireEvent.click(screen.getByText("Open in WhatsApp"));
    await screen.findByText(/Sent\? Saroj Karki \(2 of 2\)/);
    expect(openSpy).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText("Yes, I sent it"));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
  });
  it("a lead with no way to send is shown but can't be ticked, and is never counted", async () => {
    stub([card("a", "Ramesh Adhikari", "whatsapp"), { ...card("c", "Saroj Karki", null, null), error: "no_channel" }]);
    mount();
    await screen.findByText("Hi Ramesh, checking in.");
    expect(screen.getByText(/nothing to send from here/)).toBeTruthy();
    expect((screen.getByLabelText("Include Saroj Karki") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Go through 1")).toBeTruthy();
  });
  it("the footer note says unticked drafts can be opened later", async () => {
    stub([card("a", "Ramesh Adhikari", "whatsapp")]);
    mount();
    await screen.findByText("Hi Ramesh, checking in.");
    expect(screen.getByText(/Unticked ones are not sent; you can open them later from their row for 24 hours/)).toBeTruthy();
  });
});
