import { describe, it, expect, beforeEach } from "vitest";
import MailComposer from "nodemailer/lib/mail-composer";
import { sanitizeHeaderName } from "./header-name";
import { mintToken, parseInboundAddress } from "./inbound/tokens";

// RFC 5322 header folding: a long header value wraps onto a continuation line
// that starts with whitespace. Unfold before line-based assertions so a long
// Reply-To value isn't split across two lines.
function decodeRaw(built: Buffer): string {
  return built.toString("utf8").replace(/\r\n[ \t]+/g, " ");
}

const DOMAIN = "inbound.edgex.zunkireelabs.com";

beforeEach(() => {
  process.env.INBOUND_TOKEN_SECRET = "a".repeat(64);
  process.env.INBOUND_EMAIL_DOMAINS = DOMAIN;
  process.env.INBOUND_ENV_MARKER = "l";
});

describe("sanitizeHeaderName", () => {
  it("strips CR/LF and angle brackets", () => {
    expect(sanitizeHeaderName("Admizz\r\nEducation<script>")).toBe("AdmizzEducationscript");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeHeaderName("  Admizz Education  ")).toBe("Admizz Education");
  });

  it("caps at 120 characters", () => {
    const long = "a".repeat(200);
    const result = sanitizeHeaderName(long);
    expect(result).toHaveLength(120);
    expect(result).toBe("a".repeat(120));
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(sanitizeHeaderName("   \r\n  ")).toBe("");
  });
});

describe("Reply-To display name — object-form composition", () => {
  it("header-injection guard: a sanitized malicious from_name cannot inject a Bcc line", async () => {
    const evilRaw = "Evil\r\nBcc: attacker@evil.com";
    const brand = sanitizeHeaderName(evilRaw);
    const minted = mintToken("reply");

    const mail = new MailComposer({
      from: "rep@zunkireelabs.com",
      to: "lead@example.com",
      subject: "Hello",
      text: "Hi",
      replyTo: { name: brand, address: minted.address },
    });
    const raw = decodeRaw(await mail.compile().build());

    expect(raw).not.toMatch(/^Bcc:/im);
    expect(raw).toContain(`Reply-To: "${brand}" <${minted.address}>`);
  });

  it("round-trip: a composed Reply-To with a display name resolves to the same token as the bare address", async () => {
    const minted = mintToken("reply");

    const mail = new MailComposer({
      from: "rep@zunkireelabs.com",
      to: "lead@example.com",
      subject: "Hello",
      text: "Hi",
      replyTo: { name: "Admizz Education", address: minted.address },
    });
    const raw = decodeRaw(await mail.compile().build());

    const replyToLine = raw.split(/\r?\n/).find((line) => /^Reply-To:/i.test(line));
    expect(replyToLine).toBeDefined();

    const headerValue = replyToLine!.replace(/^Reply-To:\s*/i, "");
    const parsed = parseInboundAddress(headerValue);
    expect(parsed).toEqual({ verb: "reply", token: minted.token });

    const bareParsed = parseInboundAddress(minted.address);
    expect(parsed).toEqual(bareParsed);
  });

  it("empty brand produces a bare Reply-To with no display name (today's behavior)", async () => {
    const minted = mintToken("reply");

    const mail = new MailComposer({
      from: "rep@zunkireelabs.com",
      to: "lead@example.com",
      subject: "Hello",
      text: "Hi",
      replyTo: minted.address,
    });
    const raw = decodeRaw(await mail.compile().build());

    expect(raw).toContain(`Reply-To: ${minted.address}`);
    expect(raw).not.toMatch(/Reply-To: ".*"/);
  });
});
