// DB-backed, same precedent as src/lib/sms/credits-idempotency.test.ts and
// src/lib/email/outbound/send.test.ts: points the REAL createServiceClient() at the
// local Supabase stack (rather than mocking supabase-js) so processInboundEvents /
// processInboundEventsByIds run their actual production code path end to end,
// including the Postgres `~` regex filter in resolveLeadByPhone — a unit mock could
// never catch a bug that only exists in the SQL operator choice.
//
// Covers S2-C (docs/WHATSAPP-GOLIVE-SONNET-BRIEF.md): the phone-matching test matrix,
// the never-overwrite retry-link-once fix, and the S2-B after()/cron race (both entry
// points processing the same event is a safe no-op via the events-table status guard +
// the messages ON CONFLICT idempotency).
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { requireLocalDbInCi } from "@/lib/test-support/require-db-in-ci";
import { encryptToken } from "./crypto";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
// Fixed, test-only 32-byte key (hex) — never used outside this process.
process.env.INBOX_TOKEN_ENC_KEY = "0".repeat(64);

const API_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const db = createClient(API_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let localDbAvailable = false;
let tenantId: string;
let pipelineId: string;
let channelId: string;

async function makeChannel(accessToken?: string): Promise<string> {
  const { data, error } = await db
    .from("inbox_channels")
    .insert({
      tenant_id: tenantId,
      provider: "whatsapp",
      external_account_id: `test-${crypto.randomUUID()}`,
      display_name: "Test channel",
      status: "active",
      access_token: accessToken ? encryptToken(accessToken) : null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`failed to create test channel: ${error?.message}`);
  return (data as { id: string }).id;
}

async function makeLead(phone: string | null, overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await db
    .from("leads")
    .insert({
      tenant_id: tenantId,
      pipeline_id: pipelineId,
      first_name: "Test",
      last_name: "Lead",
      phone,
      is_final: true,
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`failed to create test lead: ${error?.message}`);
  return (data as { id: string }).id;
}

async function enqueueInboundEvent(params: {
  externalContactId: string;
  contactPhone: string | null;
  providerMessageId?: string;
  channelId?: string;
  attachments?: unknown[];
  contentText?: string | null;
}): Promise<string> {
  const { data, error } = await db
    .from("events")
    .insert({
      tenant_id: tenantId,
      type: "inbox.inbound_received",
      entity_type: "inbox_channel",
      entity_id: params.channelId ?? channelId,
      payload: {
        channel_id: params.channelId ?? channelId,
        tenant_id: tenantId,
        provider: "whatsapp",
        external_contact_id: params.externalContactId,
        contact_phone: params.contactPhone,
        contact_display_name: null,
        provider_message_id: params.providerMessageId ?? crypto.randomUUID(),
        provider_timestamp: new Date().toISOString(),
        content_text: params.contentText ?? "hello",
        attachments: params.attachments ?? [],
      },
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`failed to enqueue test event: ${error?.message}`);
  return (data as { id: string }).id;
}

beforeAll(async () => {
  try {
    const { data, error } = await db.from("pipelines").select("id, tenant_id").limit(1).single();
    if (error || !data) return;
    pipelineId = (data as { id: string; tenant_id: string }).id;
    tenantId = (data as { id: string; tenant_id: string }).tenant_id;
    channelId = await makeChannel();
    localDbAvailable = true;
  } catch {
    // Local Supabase stack not running.
  }
}, 10000);

beforeAll(() => requireLocalDbInCi(localDbAvailable, "inbox process-inbound phone linking + after()/cron race"));

afterEach(async () => {
  if (!localDbAvailable) return;
  // Clean up everything scoped to this test's channel so suffix-matching tests
  // (which scan all of the tenant's leads) never see a previous test's rows.
  await db.from("messages").delete().eq("channel_id", channelId);
  await db.from("conversations").delete().eq("channel_id", channelId);
  await db.from("events").delete().eq("entity_id", channelId);
  await db.from("leads").delete().eq("tenant_id", tenantId).eq("last_name", "Lead");
});

describe("resolveLeadByPhone matching matrix (S2-C)", () => {
  const cases: {
    name: string;
    storedPhone: string;
    incomingWaFrom: string; // digits only, as WhatsApp's msg.from arrives (no leading +)
    shouldLink: boolean;
  }[] = [
    { name: "Nepal number, stored with a '+' and no separators", storedPhone: "+9779812345678", incomingWaFrom: "9779812345678", shouldLink: true },
    { name: "Nepal number, stored as bare local digits", storedPhone: "9812345678", incomingWaFrom: "9779812345678", shouldLink: true },
    { name: "Nepal number, stored with a space before the local number", storedPhone: "+977 9812345678", incomingWaFrom: "9779812345678", shouldLink: true },
    { name: "Nepal number, stored with a dash INSIDE the trailing 10 digits (the real bug)", storedPhone: "+977-981-2345678", incomingWaFrom: "9779812345678", shouldLink: true },
    { name: "Indian number, stored with parens + dash", storedPhone: "+91 (981) 234-5678", incomingWaFrom: "919812345678", shouldLink: true },
  ];

  for (const c of cases) {
    it(c.name, async (ctx) => {
      if (!localDbAvailable) { ctx.skip(); return; }

      const leadId = await makeLead(c.storedPhone);
      const eventId = await enqueueInboundEvent({
        externalContactId: c.incomingWaFrom,
        contactPhone: `+${c.incomingWaFrom}`,
      });

      const { processInboundEventsByIds } = await import("./process-inbound");
      const result = await processInboundEventsByIds([eventId]);
      expect(result.errors).toBe(0);
      expect(result.processed).toBe(1);

      const { data: conv } = await db
        .from("conversations")
        .select("lead_id")
        .eq("channel_id", channelId)
        .eq("external_contact_id", c.incomingWaFrom)
        .single();

      if (c.shouldLink) {
        expect((conv as { lead_id: string | null }).lead_id).toBe(leadId);
      } else {
        expect((conv as { lead_id: string | null }).lead_id).toBeNull();
      }
    });
  }

  it("two leads sharing the same trailing digits → no link (ambiguous, never auto-pick)", async (ctx) => {
    if (!localDbAvailable) { ctx.skip(); return; }

    await makeLead("+9779812345679");
    await makeLead("9812345679");
    const eventId = await enqueueInboundEvent({ externalContactId: "9779812345679", contactPhone: "+9779812345679" });

    const { processInboundEventsByIds } = await import("./process-inbound");
    await processInboundEventsByIds([eventId]);

    const { data: conv } = await db
      .from("conversations")
      .select("lead_id")
      .eq("channel_id", channelId)
      .eq("external_contact_id", "9779812345679")
      .single();
    expect((conv as { lead_id: string | null }).lead_id).toBeNull();
  });

  it("a soft-deleted lead is never matched", async (ctx) => {
    if (!localDbAvailable) { ctx.skip(); return; }

    await makeLead("+9779812345680", { deleted_at: new Date().toISOString() });
    const eventId = await enqueueInboundEvent({ externalContactId: "9779812345680", contactPhone: "+9779812345680" });

    const { processInboundEventsByIds } = await import("./process-inbound");
    await processInboundEventsByIds([eventId]);

    const { data: conv } = await db
      .from("conversations")
      .select("lead_id")
      .eq("channel_id", channelId)
      .eq("external_contact_id", "9779812345680")
      .single();
    expect((conv as { lead_id: string | null }).lead_id).toBeNull();
  });

  it("a non-final (partial/draft) lead is never matched", async (ctx) => {
    if (!localDbAvailable) { ctx.skip(); return; }

    await makeLead("+9779812345681", { is_final: false });
    const eventId = await enqueueInboundEvent({ externalContactId: "9779812345681", contactPhone: "+9779812345681" });

    const { processInboundEventsByIds } = await import("./process-inbound");
    await processInboundEventsByIds([eventId]);

    const { data: conv } = await db
      .from("conversations")
      .select("lead_id")
      .eq("channel_id", channelId)
      .eq("external_contact_id", "9779812345681")
      .single();
    expect((conv as { lead_id: string | null }).lead_id).toBeNull();
  });

  it("an incoming number with fewer than 8 digits is never matched, even against an identical short stored phone", async (ctx) => {
    if (!localDbAvailable) { ctx.skip(); return; }

    await makeLead("1234567");
    const eventId = await enqueueInboundEvent({ externalContactId: "1234567", contactPhone: "1234567" });

    const { processInboundEventsByIds } = await import("./process-inbound");
    const result = await processInboundEventsByIds([eventId]);
    expect(result.errors).toBe(0);

    const { data: conv } = await db
      .from("conversations")
      .select("lead_id")
      .eq("channel_id", channelId)
      .eq("external_contact_id", "1234567")
      .single();
    expect((conv as { lead_id: string | null }).lead_id).toBeNull();
  });
});

describe("retry-link-once (S2-C fix b): a lead created AFTER the conversation", () => {
  it("links on the NEXT inbound message once a matching lead exists, without overwriting a later manual link", async (ctx) => {
    if (!localDbAvailable) { ctx.skip(); return; }

    // First message arrives with no matching lead yet — conversation created, lead_id null.
    const firstEventId = await enqueueInboundEvent({ externalContactId: "9779812345690", contactPhone: "+9779812345690" });
    const { processInboundEventsByIds } = await import("./process-inbound");
    await processInboundEventsByIds([firstEventId]);

    const { data: convBefore } = await db
      .from("conversations")
      .select("id, lead_id")
      .eq("channel_id", channelId)
      .eq("external_contact_id", "9779812345690")
      .single();
    expect((convBefore as { lead_id: string | null }).lead_id).toBeNull();

    // Now the lead gets created (e.g. the student also submitted the web form).
    const leadId = await makeLead("+9779812345690");

    // Second inbound message — retry should pick it up this time.
    const secondEventId = await enqueueInboundEvent({ externalContactId: "9779812345690", contactPhone: "+9779812345690" });
    await processInboundEventsByIds([secondEventId]);

    const { data: convAfter } = await db
      .from("conversations")
      .select("id, lead_id")
      .eq("channel_id", channelId)
      .eq("external_contact_id", "9779812345690")
      .single();
    expect((convAfter as { lead_id: string | null }).lead_id).toBe(leadId);

    // A THIRD inbound message arrives after a human manually re-links the conversation
    // to a different lead — the retry must never clobber that human choice.
    const otherLeadId = await makeLead("+9779812345699"); // different number, simulates "wrong number, manually fixed"
    await db
      .from("conversations")
      .update({ lead_id: otherLeadId })
      .eq("id", (convAfter as { id: string }).id);

    const thirdEventId = await enqueueInboundEvent({ externalContactId: "9779812345690", contactPhone: "+9779812345690" });
    await processInboundEventsByIds([thirdEventId]);

    const { data: convFinal } = await db
      .from("conversations")
      .select("lead_id")
      .eq("id", (convAfter as { id: string }).id)
      .single();
    expect((convFinal as { lead_id: string | null }).lead_id).toBe(otherLeadId);
  });
});

describe("S2-B: after()/cron race is a safe no-op", () => {
  it("processInboundEventsByIds and processInboundEvents racing on the same event never double-process or error", async (ctx) => {
    if (!localDbAvailable) { ctx.skip(); return; }

    const providerMessageId = crypto.randomUUID();
    const eventId = await enqueueInboundEvent({
      externalContactId: "9779812345695",
      contactPhone: "+9779812345695",
      providerMessageId,
    });

    const { processInboundEventsByIds, processInboundEvents } = await import("./process-inbound");

    // Simulate the webhook's after() call and the */15 cron both picking up the
    // same pending event at roughly the same time.
    const [afterResult, cronResult] = await Promise.all([
      processInboundEventsByIds([eventId]),
      processInboundEvents(50),
    ]);

    // "Harmless" doesn't mean only one side claims it — both fetches can legitimately see
    // the row as 'pending' before either writes 'completed' back (there's no row-level
    // claim/lock, just the idempotent message insert underneath). The actual invariant
    // the brief asks for is: neither side errors, and the ON CONFLICT on
    // (channel_id, provider_message_id) means only ONE message row ever lands no matter
    // how many times the same event gets processed.
    expect(afterResult.errors).toBe(0);
    expect(cronResult.errors).toBe(0);
    expect(afterResult.processed + cronResult.processed).toBeGreaterThanOrEqual(1);

    const { data: messages } = await db
      .from("messages")
      .select("id")
      .eq("channel_id", channelId)
      .eq("provider_message_id", providerMessageId);
    expect(messages).toHaveLength(1);

    const { data: eventRow } = await db.from("events").select("status").eq("id", eventId).single();
    expect((eventRow as { status: string }).status).toBe("completed");
  });
});

describe("S2-A: inbound media resolve + persist", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The test db client (plain createClient, no undici override) and the test's own
  // call to enqueueInboundEvent() also go over global `fetch` to hit local Supabase —
  // only the two Graph API calls (graph.example) should be intercepted, everything
  // else must pass through to the real network, or the test harness's own setup calls
  // break too.
  function stubGraphFetch(mockGraphCalls: (url: string, init?: RequestInit) => unknown) {
    const realFetch = globalThis.fetch;
    const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("graph.example") || href.includes("graph.facebook.com")) {
        return Promise.resolve(mockGraphCalls(href, init));
      }
      return realFetch(url as never, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("happy path: resolves the media id, downloads bytes, stores them in inbox-media, and patches the final shape onto the message", async (ctx) => {
    if (!localDbAvailable) { ctx.skip(); return; }

    const mediaChannelId = await makeChannel("test-plaintext-token");
    let call = 0;
    const fetchMock = stubGraphFetch(() => {
      call++;
      if (call === 1) {
        return { ok: true, json: async () => ({ url: "https://graph.example/media-bytes", mime_type: "image/jpeg", file_size: 4 }) };
      }
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
    });

    const eventId = await enqueueInboundEvent({
      externalContactId: "9779800001234",
      contactPhone: "+9779800001234",
      channelId: mediaChannelId,
      contentText: "my passport",
      attachments: [{ type: "image", providerMediaId: "media-abc", mimeType: "image/jpeg", filename: null }],
    });

    const { processInboundEventsByIds } = await import("./process-inbound");
    const result = await processInboundEventsByIds([eventId]);
    expect(result.errors).toBe(0);

    const graphCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("graph")) as [string, { headers: Record<string, string> }][];
    expect(graphCalls).toHaveLength(2);
    // First call hits the media-metadata endpoint with the bearer token.
    const [metaUrl, metaInit] = graphCalls[0];
    expect(metaUrl).toContain("media-abc");
    expect(metaInit.headers.Authorization).toBe("Bearer test-plaintext-token");
    // Second call downloads from the resolved url, also with the bearer token.
    const [bytesUrl, bytesInit] = graphCalls[1];
    expect(bytesUrl).toBe("https://graph.example/media-bytes");
    expect(bytesInit.headers.Authorization).toBe("Bearer test-plaintext-token");

    const { data: msg } = await db
      .from("messages")
      .select("content_text, attachments")
      .eq("channel_id", mediaChannelId)
      .single();
    const row = msg as { content_text: string; attachments: Record<string, unknown>[] };
    expect(row.content_text).toBe("my passport"); // caption preserved
    expect(row.attachments).toHaveLength(1);
    expect(row.attachments[0]).toMatchObject({
      type: "image",
      provider_media_id: "media-abc",
      bucket: "inbox-media",
      mime_type: "image/jpeg",
      size: 4,
    });
    expect(row.attachments[0].path).toMatch(new RegExp(`^${tenantId}/inbox/`));
    expect(row.attachments[0].error).toBeUndefined();

    await db.from("messages").delete().eq("channel_id", mediaChannelId);
    await db.from("conversations").delete().eq("channel_id", mediaChannelId);
    await db.from("events").delete().eq("entity_id", mediaChannelId);
    await db.from("inbox_channels").delete().eq("id", mediaChannelId);
  });

  it("failure path: a Graph API failure marks the attachment with an error but leaves the message text intact and the event completed (§5)", async (ctx) => {
    if (!localDbAvailable) { ctx.skip(); return; }

    const mediaChannelId = await makeChannel("test-plaintext-token");
    stubGraphFetch(() => ({ ok: false, status: 401 }));

    const eventId = await enqueueInboundEvent({
      externalContactId: "9779800005678",
      contactPhone: "+9779800005678",
      channelId: mediaChannelId,
      contentText: "here's my transcript",
      attachments: [{ type: "document", providerMediaId: "media-xyz", mimeType: "application/pdf", filename: "transcript.pdf" }],
    });

    const { processInboundEventsByIds } = await import("./process-inbound");
    const result = await processInboundEventsByIds([eventId]);
    // The EVENT completes — a media failure is not an event-processing error.
    expect(result.errors).toBe(0);
    expect(result.processed).toBe(1);

    const { data: msg } = await db
      .from("messages")
      .select("content_text, attachments, status")
      .eq("channel_id", mediaChannelId)
      .single();
    const row = msg as { content_text: string; attachments: Record<string, unknown>[]; status: string };
    expect(row.content_text).toBe("here's my transcript"); // text survives the media failure
    expect(row.status).toBe("received");
    expect(row.attachments).toHaveLength(1);
    expect(row.attachments[0]).toMatchObject({ type: "document", provider_media_id: "media-xyz" });
    expect(row.attachments[0].path).toBeUndefined(); // never a Meta URL, never a half-written path
    expect(typeof row.attachments[0].error).toBe("string");

    const { data: eventRow } = await db.from("events").select("status").eq("id", eventId).single();
    expect((eventRow as { status: string }).status).toBe("completed"); // not stuck retrying forever

    await db.from("messages").delete().eq("channel_id", mediaChannelId);
    await db.from("conversations").delete().eq("channel_id", mediaChannelId);
    await db.from("events").delete().eq("entity_id", mediaChannelId);
    await db.from("inbox_channels").delete().eq("id", mediaChannelId);
  });

  it("a text-only message never touches the network (no channel-token lookup, no fetch)", async (ctx) => {
    if (!localDbAvailable) { ctx.skip(); return; }

    const fetchMock = stubGraphFetch(() => ({ ok: true, json: async () => ({}) }));

    const eventId = await enqueueInboundEvent({ externalContactId: "9779800009999", contactPhone: "+9779800009999" });
    const { processInboundEventsByIds } = await import("./process-inbound");
    await processInboundEventsByIds([eventId]);

    // Real calls (to local Supabase) pass through and don't count as "Graph calls" —
    // what matters is that none of the calls through this stub were for graph.facebook.com.
    const graphCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("graph.facebook.com"));
    expect(graphCalls).toHaveLength(0);
  });
});
