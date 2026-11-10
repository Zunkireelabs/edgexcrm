import { describe, expect, it } from "vitest";
import { availableChannels, counsellorFirstName, defaultChannel, draftLabel, hasGenderedPronoun, outcomeOf, relativeAge, sameText, shortTenantName, unbackedTimeWords, waLink, whatsappTimelineNote } from "./draft";
import { sendToLead, textToHtml } from "./send-to-lead";

describe("tab rules", () => {
  it("SMS never appears; tabs follow what the person can actually use", () => {
    expect(availableChannels({ hasPhone: true, hasGmail: true })).toEqual(["whatsapp", "email"]);
    expect(availableChannels({ hasPhone: true, hasGmail: false })).toEqual(["whatsapp"]);
    expect(availableChannels({ hasPhone: false, hasGmail: true })).toEqual(["email"]);
  });
  it("a lead with no phone and no Gmail has no tabs: the panel shows Copy only", () => {
    expect(availableChannels({ hasPhone: false, hasGmail: false })).toEqual([]);
    expect(defaultChannel({ hasPhone: false, hasGmail: false, lastReplyChannel: null })).toBeNull();
  });
  it("default = the channel the lead last replied on, else WhatsApp when there is a phone", () => {
    const both = { hasPhone: true, hasGmail: true };
    expect(defaultChannel({ ...both, lastReplyChannel: "email" })).toBe("email");
    expect(defaultChannel({ ...both, lastReplyChannel: "whatsapp" })).toBe("whatsapp");
    expect(defaultChannel({ ...both, lastReplyChannel: null })).toBe("whatsapp");
    expect(defaultChannel({ ...both, lastReplyChannel: "sms" })).toBe("whatsapp"); // SMS is not offered
  });
  it("a last-reply channel the person can't use falls back", () => {
    expect(defaultChannel({ hasPhone: true, hasGmail: false, lastReplyChannel: "email" })).toBe("whatsapp");
    expect(defaultChannel({ hasPhone: false, hasGmail: true, lastReplyChannel: null })).toBe("email");
  });
});

describe("which rows get Draft", () => {
  it("reply, missing document and overdue call-back rows; never grouped rows or leadless rows", () => {
    expect(draftLabel({ kind: "reply_waiting", leadId: "l" })).toBe("Draft reply");
    expect(draftLabel({ kind: "deadline_docs", leadId: "l" })).toBe("Draft");
    expect(draftLabel({ kind: "callback_overdue", leadId: "l" })).toBe("Draft");
    expect(draftLabel({ kind: "going_quiet", leadId: "l", children: [{} as never] })).toBeNull();
    expect(draftLabel({ kind: "new_uncalled", leadId: "l" })).toBeNull();
    expect(draftLabel({ kind: "reply_waiting" })).toBeNull();
  });
});

describe("edited vs as-is is whitespace-insensitive", () => {
  it("re-flowed lines and a trailing newline are not an edit", () => {
    expect(sameText("Hi Sita,\nsend it  today.", "Hi Sita, send it today.\n")).toBe(true);
    expect(outcomeOf("Hi Sita, send it today.", "  Hi Sita,\n\nsend it today. ")).toBe("sent_as_is");
  });
  it("a changed word is an edit", () => {
    expect(outcomeOf("Hi Sita, send it today.", "Hi Sita, send it tomorrow.")).toBe("edited");
  });
});

describe("WhatsApp hand-off", () => {
  it("wa.me with digits only and the text encoded", () => {
    expect(waLink("+977 984-123-4567", "Hi Sita & co")).toBe("https://wa.me/9779841234567?text=Hi%20Sita%20%26%20co");
    expect(waLink("00977 9841234567", "x")).toBe("https://wa.me/9779841234567?text=x");
  });
  it("no usable number, no link", () => {
    expect(waLink(null, "x")).toBeNull();
    expect(waLink("12", "x")).toBeNull();
  });
  it("the timeline note says it was sent from the phone", () => {
    expect(whatsappTimelineNote("  Hi Sita ")).toBe("WhatsApp message (sent from your phone):\nHi Sita");
  });
});

describe("sendToLead: the one seam", () => {
  it("whatsapp is a hand-off, never 'sent' (we cannot confirm delivery), and makes no request", async () => {
    let called = false;
    const r = await sendToLead("whatsapp", { leadId: "L", text: "Hi", phone: "+9779841234567" }, (async () => { called = true; return new Response("{}"); }) as typeof fetch);
    expect(r).toEqual({ kind: "handoff", url: "https://wa.me/9779841234567?text=Hi" });
    expect(called).toBe(false);
  });
  it("whatsapp with no number fails plainly", async () => {
    expect((await sendToLead("whatsapp", { leadId: "L", text: "Hi", phone: null })).kind).toBe("failed");
  });
  it("email goes through /api/v1/email/send with the lead id, and reports failures", async () => {
    let body: Record<string, unknown> = {};
    const ok = (async (_u: string, init: RequestInit) => { body = JSON.parse(init.body as string); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    expect(await sendToLead("email", { leadId: "L", text: "Hi\n\nBye", subject: "Docs", email: { fromAccountId: "acc", to: "s@x.com" } }, ok)).toEqual({ kind: "sent" });
    expect(body).toMatchObject({ from_account_id: "acc", to: ["s@x.com"], subject: "Docs", lead_id: "L", body_html: "<p>Hi</p><p>Bye</p>" });
    const bad = (async () => new Response(JSON.stringify({ error: { message: "Gmail refused" } }), { status: 503 })) as unknown as typeof fetch;
    expect(await sendToLead("email", { leadId: "L", text: "Hi", email: { fromAccountId: "a", to: "s@x.com" } }, bad)).toEqual({ kind: "failed", message: "Gmail refused" });
  });
  it("email with no connected Gmail fails plainly", async () => {
    expect((await sendToLead("email", { leadId: "L", text: "Hi" })).kind).toBe("failed");
  });
  it("text becomes safe HTML", () => {
    expect(textToHtml("a <b> & c")).toBe("<p>a &lt;b&gt; &amp; c</p>");
  });
});

describe("S1/S3 names", () => {
  it("the tenant's short name", () => {
    expect(shortTenantName("Admizz Education")).toBe("Admizz");
    expect(shortTenantName("  ")).toBeNull();
    expect(shortTenantName(null)).toBeNull();
  });
  it("the counsellor's name is the profile name Home greets with: name, else full_name; none means none; never the email", () => {
    expect(counsellorFirstName({ name: "Rita Karki" })).toBe("Rita");
    expect(counsellorFirstName({ full_name: "Rita Karki" })).toBe("Rita");
    expect(counsellorFirstName({ email: "admizzintern4@gmail.com" })).toBeNull();
    expect(counsellorFirstName({})).toBeNull();
    expect(counsellorFirstName(undefined)).toBeNull();
    expect(counsellorFirstName({ name: "   " })).toBeNull();
  });
});

describe("S2 timing", () => {
  const now = new Date("2026-11-09T08:00:00.000Z");
  it("relative age by tenant calendar day", () => {
    expect(relativeAge("2026-11-09T01:00:00.000Z", now, "UTC")).toBe("today");
    expect(relativeAge("2026-11-08T23:00:00.000Z", now, "UTC")).toBe("yesterday");
    expect(relativeAge("2026-11-04T05:00:00.000Z", now, "UTC")).toBe("5 days ago");
  });
  it("time words are refused unless a fact has them (English and Nepali)", () => {
    expect(unbackedTimeWords(["I called yesterday"], ["Last call: 5 days ago"])).toEqual(["yesterday"]);
    expect(unbackedTimeWords(["मैले हिजो फोन गरें"], [])).toEqual(["हिजो"]);
    expect(unbackedTimeWords(["as we discussed last week"], ["Message 1 (last week): hi"])).toEqual([]);
    expect(unbackedTimeWords(["I called you 5 days ago"], ["Last call: 5 days ago"])).toEqual([]);
  });
});

describe("S4 pronouns", () => {
  it("he/she/his/her/him are flagged, names and 'the' are not", () => {
    for (const t of ["her Australia interest", "call her", "he said", "his file", "tell him"]) expect(hasGenderedPronoun([t])).toBe(true);
    for (const t of ["Sita's Australia interest", "other here", "there is the file"]) expect(hasGenderedPronoun([t])).toBe(false);
  });
});

describe("Q1(c): the model reads notes without he / she", () => {
  it("he / she / him become the name, his / hers the name's, and her follows its use", async () => {
    const { neutralizePronouns } = await import("./draft");
    expect(neutralizePronouns("He is already in Korea.", "Bishal")).toBe("Bishal is already in Korea.");
    expect(neutralizePronouns("She said her results come out next month, so call her.", "Nisha")).toBe("Nisha said Nisha's results come out next month, so call Nisha.");
    expect(neutralizePronouns("Wants his brother's city; the fee is hers.", "Aman")).toBe("Wants Aman's brother's city; the fee is Aman's.");
    expect(neutralizePronouns("Asked about the other option (not her)", "Sita")).toBe("Asked about the other option (not Sita)");
    expect(neutralizePronouns("The shelf and the other were checked", "Sita")).toBe("The shelf and the other were checked"); // words that merely contain he / her
  });
  it("originalWords finds the counsellor's own sentence for a quote read from the neutral copy", async () => {
    const { originalWords } = await import("./draft");
    const notes = ["Call at 4pm. He is already in Korea, working there.", "She doesn't have any plans regarding abroad."];
    expect(originalWords("Bishal is already in Korea", "Bishal", notes)).toBe("He is already in Korea");
    expect(originalWords("Nisha doesn't have any plans regarding abroad.", "Nisha", notes)).toBe("She doesn't have any plans regarding abroad");
    expect(originalWords("Bishal's visa was refused", "Bishal", notes)).toBeNull();
    expect(originalWords("Number is not registered on WhatsApp", "Kamal", ["Number is not registered on WhatsApp."])).toBe("Number is not registered on WhatsApp");
  });
});
