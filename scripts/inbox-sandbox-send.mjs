#!/usr/bin/env node
// Dev-only smoke tool for the Unified Inbox sandbox channel.
// Injects a signed fake inbound message, then drains the async processor —
// so a conversation + message appear live in /inbox (and you can reply).
//
// Usage:
//   node scripts/inbox-sandbox-send.mjs "message text" [fromId] [phone] [name]
//
// Reads INBOX_SANDBOX_SECRET + INTERNAL_CRON_SECRET from .env.local (no secrets on the CLI).
// Restart `npm run dev` after those env vars are added, or the webhook will 403.

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.env.INBOX_BASE_URL || "http://localhost:3000";
const CHANNEL_ID = process.env.INBOX_SANDBOX_CHANNEL_ID || "b0000000-0000-4000-8000-000000000001";

function envFromFile(key) {
  try {
    const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const m = txt.match(new RegExp("^" + key + "=(.*)$", "m"));
    return m ? m[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

const SANDBOX_SECRET = process.env.INBOX_SANDBOX_SECRET || envFromFile("INBOX_SANDBOX_SECRET");
const CRON_SECRET = process.env.INTERNAL_CRON_SECRET || envFromFile("INTERNAL_CRON_SECRET");

if (!SANDBOX_SECRET || !CRON_SECRET) {
  console.error("✗ Missing INBOX_SANDBOX_SECRET or INTERNAL_CRON_SECRET in .env.local.");
  process.exit(1);
}

const text = process.argv[2] || "Hi! I'm interested in your services 👋";
const fromId = process.argv[3] || "sandbox_user_1";
const phone = process.argv[4] || "+9779800000001";
const name = process.argv[5] || "Sandbox Tester";

const payload = JSON.stringify({
  messages: [
    {
      from: fromId,
      from_phone: phone,
      from_name: name,
      message_id: "sbx_" + randomUUID(),
      timestamp: new Date().toISOString(),
      text,
    },
  ],
});

const sig = "sha256=" + createHmac("sha256", SANDBOX_SECRET).update(payload).digest("hex");

const inbound = await fetch(`${BASE}/api/webhooks/sandbox`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-channel-id": CHANNEL_ID,
    "x-hub-signature-256": sig,
  },
  body: payload,
});
console.log("webhook  ->", inbound.status, (await inbound.text()).slice(0, 200));

if (inbound.status !== 200) {
  console.error("✗ Webhook rejected — did you restart `npm run dev` after adding the secrets?");
  process.exit(1);
}

const drain = await fetch(`${BASE}/api/internal/inbox/process`, {
  method: "POST",
  headers: { Authorization: `Bearer ${CRON_SECRET}` },
});
console.log("process  ->", drain.status, (await drain.text()).slice(0, 200));
console.log(`\n✓ Sent "${text}" from ${name} (${phone}). Open /inbox — it should appear live.`);
