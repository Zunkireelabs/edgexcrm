// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { StrictMode, useState } from "react";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BatchPanel, useBatchRun } from "./batch-panel";
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
// Like Home: the press starts the request (never an effect), and the panel only shows what came back.
function Host({ onSent }: { onSent: () => void }) {
  const run = useBatchRun(ENTRIES);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); run.start(); }}>Prepare</button>
      <BatchPanel entries={ENTRIES} open={open} onClose={() => { setOpen(false); run.reset(); }} onSent={onSent} run={run} />
    </>
  );
}
const mount = (onSent = () => {}) => {
  const r = render(<Host onSent={onSent} />);
  fireEvent.click(screen.getByText("Prepare"));
  return r;
};
const batchPosts = () => calls.filter((c) => c.url === "/api/v1/home/draft-batch");

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

describe("P3/P4 in the panel", () => {
  it("P3: the chip is 'On WhatsApp' when every card is WhatsApp, 'WhatsApp and email' when mixed", async () => {
    stub([card("a", "Ramesh Adhikari", "whatsapp"), card("c", "Saroj Karki", "whatsapp")]);
    const { unmount } = mount();
    await screen.findByText("Hi Ramesh, checking in.");
    expect(screen.getByText("On WhatsApp")).toBeTruthy();
    expect(screen.queryByText(/last replied on/)).toBeNull();
    unmount();
    stub([card("a", "Ramesh Adhikari", "whatsapp"), card("b", "Dipa Lama", "email")]);
    mount();
    await screen.findByText("Hi Ramesh, checking in.");
    expect(screen.getByText("WhatsApp and email")).toBeTruthy();
  });
  it("P4: the footer counts sent and not sent, and the 'No' answers come round again at the end", async () => {
    stub([card("a", "Ramesh Adhikari", "whatsapp"), card("c", "Saroj Karki", "whatsapp"), card("d", "Mina Gurung", "whatsapp")]);
    mount();
    await screen.findByText("Hi Ramesh, checking in.");
    fireEvent.click(screen.getByText("Go through 3"));
    await screen.findByText(/Sent\? Ramesh Adhikari \(1 of 3\) · 0 sent · 0 not sent/);
    fireEvent.click(screen.getByText("No")); // Ramesh: not sent
    await screen.findByText(/Next: Saroj Karki \(2 of 3\) · 0 sent · 1 not sent/);
    fireEvent.click(screen.getByText("Open in WhatsApp"));
    fireEvent.click(await screen.findByText("Yes, I sent it")); // Saroj: sent
    await screen.findByText(/Next: Mina Gurung \(3 of 3\) · 1 sent · 1 not sent/);
    fireEvent.click(screen.getByText("Open in WhatsApp"));
    fireEvent.click(await screen.findByText("Yes, I sent it")); // Mina: sent
    // end of the round: Ramesh (No) comes round again
    await screen.findByText(/Asking again: Ramesh Adhikari \(1 of 1\) · 2 sent · 1 not sent/);
    expect(openSpy).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByText("Open in WhatsApp"));
    await screen.findByText(/Sent\? Ramesh Adhikari \(1 of 1\)/);
    expect(openSpy).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByText("Yes, I sent it"));
    await waitFor(() => expect(screen.queryByText(/Sent\? Ramesh/)).toBeNull());
    expect(calls.filter((c) => c.url === "/api/v1/home/draft-resolve" && c.body.action === "sent").map((c) => c.body.draftId)).toEqual(["dr-c", "dr-d", "dr-a"]);
  });
  it("P4: a second No on the same lead is not asked a third time", async () => {
    stub([card("a", "Ramesh Adhikari", "whatsapp")]);
    mount();
    await screen.findByText("Hi Ramesh, checking in.");
    fireEvent.click(screen.getByText("Go through 1"));
    fireEvent.click(await screen.findByText("No"));
    await screen.findByText(/Asking again: Ramesh Adhikari \(1 of 1\)/);
    fireEvent.click(screen.getByText("Open in WhatsApp"));
    fireEvent.click(await screen.findByText("No"));
    await waitFor(() => expect(screen.queryByText(/Asking again: Ramesh/)).toBeNull());
    expect(openSpy).toHaveBeenCalledTimes(2);
    expect((screen.getByLabelText("Include Ramesh Adhikari") as HTMLInputElement).checked).toBe(true); // stays ticked
  });
});

describe("Q2: one press is one request", () => {
  it("a press sends exactly one draft-batch POST, even in StrictMode (which runs effects twice) and across re-renders", async () => {
    stub([card("a", "Ramesh Adhikari", "whatsapp")]);
    const { rerender } = render(<StrictMode><Host onSent={() => {}} /></StrictMode>);
    fireEvent.click(screen.getByText("Prepare"));
    fireEvent.click(screen.getByText("Prepare")); // a double click is still one request
    await screen.findByText("Hi Ramesh, checking in.");
    rerender(<StrictMode><Host onSent={() => {}} /></StrictMode>);
    expect(batchPosts()).toHaveLength(1);
  });
  it("closing and pressing again asks again (one more request)", async () => {
    stub([card("a", "Ramesh Adhikari", "whatsapp")]);
    mount();
    await screen.findByText("Hi Ramesh, checking in.");
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByText("Prepare"));
    await waitFor(() => expect(batchPosts()).toHaveLength(2));
  });
});

describe("Q3: the second round counts on its own", () => {
  it("'Asking again: X (1 of 3)': the total never grows, and the sent / not sent counts carry on", async () => {
    const names = ["Ramesh Adhikari", "Saroj Karki", "Mina Gurung", "Dipa Lama"];
    stub(names.map((n, i) => card(`l${i}`, n, "whatsapp")));
    mount();
    await screen.findByText("Hi Ramesh, checking in.");
    fireEvent.click(screen.getByText("Go through 4"));
    fireEvent.click(await screen.findByText("Yes, I sent it")); // Ramesh sent
    await screen.findByText(/Next: Saroj Karki \(2 of 4\) · 1 sent · 0 not sent/);
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByText("Open in WhatsApp"));
      fireEvent.click(await screen.findByText("No"));
      if (i < 2) await screen.findByText(new RegExp(`Next: .* \\(${i + 3} of 4\\)`));
    }
    await screen.findByText(/Asking again: Saroj Karki \(1 of 3\) · 1 sent · 3 not sent/);
    expect(screen.queryByText(/of 4\) · 1 sent · 3 not sent/)).toBeNull();
  });
});

describe("Q1: Orca suggests not sending", () => {
  const skipCard = { ...card("c", "Saroj Karki", "whatsapp", null), skip: { reason: "Already abroad, so asking about studying there is pointless.", quote: "he is already in Korea", source: "note, 7 Sep" } };
  it("shows the counsellor's own words, unticked and disabled, with Open lead; it is not in 'Go through N' and not in the message count", async () => {
    stub([card("a", "Ramesh Adhikari", "whatsapp"), skipCard]);
    mount();
    await screen.findByText("Hi Ramesh, checking in.");
    expect(screen.getByText(/Orca suggests not sending:/)).toBeTruthy();
    expect(screen.getByText(/he is already in Korea/).textContent).toContain("(note, 7 Sep)");
    const box = screen.getByLabelText("Include Saroj Karki") as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(true);
    expect(screen.getByText("Open lead").getAttribute("href")).toBe("/leads/c");
    expect(screen.getByText("Go through 1")).toBeTruthy();
    expect(screen.getByText("Check before sending · 1 message")).toBeTruthy();
    expect(screen.queryByText("Couldn't draft, write your own.")).toBeNull();
    expect(screen.queryByLabelText("Message to Saroj Karki")).toBeNull();
  });
});
