import { describe, it, expect, afterEach, vi } from "vitest";
import {
  buildWidgetSnippet,
  CHAT_OFF_ALLOWED_DOMAINS,
  DEFAULT_WEBSITE_CHAT_SETTINGS,
  mergeWebsiteChatSettings,
  normalizeWebsiteHost,
  toChatwootChannel,
  type WebsiteChatSettings,
} from "./settings";

const current: WebsiteChatSettings = { ...DEFAULT_WEBSITE_CHAT_SETTINGS, websiteHost: "admizzeducation.com" };

describe("normalizeWebsiteHost", () => {
  it.each([
    ["admizzeducation.com", "admizzeducation.com"],
    ["  HTTPS://www.Admizzeducation.com/contact?x=1 ", "www.admizzeducation.com"],
    ["http://example.co.uk:8080/a", "example.co.uk"],
    ["example.com/path", "example.com"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeWebsiteHost(input)).toBe(expected);
  });

  it.each(["", "localhost", "not a host", "ftp://example.com", "javascript:alert(1)", "-bad.com", "a..com", "http://"])(
    "rejects %j",
    (input) => {
      expect(normalizeWebsiteHost(input)).toBeNull();
    }
  );
});

describe("mergeWebsiteChatSettings", () => {
  it("changes only the fields that were sent", () => {
    const result = mergeWebsiteChatSettings(current, { color: "teal" });
    expect(result).toEqual({ ok: true, settings: { ...current, color: "teal" } });
  });

  it("does not mutate the current settings", () => {
    mergeWebsiteChatSettings(current, { fields: { email: { show: false } } });
    expect(current.fields.email.show).toBe(true);
  });

  it("rejects a colour outside the brand set", () => {
    const result = mergeWebsiteChatSettings(current, { color: "#ff00ff" });
    expect(result).toMatchObject({ ok: false, errors: { color: expect.any(Array) } });
  });

  it("rejects a bad reply time, an empty title and an over-long tagline", () => {
    const result = mergeWebsiteChatSettings(current, { replyTime: "soon", title: "  ", tagline: "x".repeat(121) });
    expect(result).toMatchObject({ ok: false, errors: { replyTime: expect.any(Array), title: expect.any(Array), tagline: expect.any(Array) } });
  });

  it("allows an empty tagline and intro", () => {
    const result = mergeWebsiteChatSettings(current, { tagline: "", formIntro: "" });
    expect(result).toMatchObject({ ok: true, settings: { tagline: "", formIntro: "" } });
  });

  it("normalizes the website address and rejects a bad one", () => {
    expect(mergeWebsiteChatSettings(current, { websiteHost: "https://New-Site.com/x" })).toMatchObject({
      ok: true,
      settings: { websiteHost: "new-site.com" },
    });
    expect(mergeWebsiteChatSettings(current, { websiteHost: "nope" })).toMatchObject({ ok: false, errors: { websiteHost: expect.any(Array) } });
  });

  it("a hidden field can never stay required", () => {
    const result = mergeWebsiteChatSettings(current, { fields: { name: { show: false } } });
    expect(result).toMatchObject({ ok: true, settings: { fields: { name: { show: false, required: false } } } });
  });

  it("keeps a way to reach the visitor: phone and email cannot both be hidden", () => {
    const result = mergeWebsiteChatSettings(current, { fields: { phone: { show: false }, email: { show: false } } });
    expect(result).toMatchObject({ ok: false, errors: { fields: expect.any(Array) } });
  });

  it("rejects unknown fields and wrong value types", () => {
    expect(mergeWebsiteChatSettings(current, { fields: { age: { show: true } } })).toMatchObject({ ok: false });
    expect(mergeWebsiteChatSettings(current, { fields: { name: { show: "yes" } } })).toMatchObject({ ok: false });
  });

  it("rejects a body that is not an object", () => {
    expect(mergeWebsiteChatSettings(current, null)).toMatchObject({ ok: false });
    expect(mergeWebsiteChatSettings(current, [])).toMatchObject({ ok: false });
  });
});

describe("toChatwootChannel", () => {
  it("maps settings to the Chatwoot web widget, with uploads off", () => {
    const channel = toChatwootChannel({ ...current, color: "teal" }, true);
    expect(channel).toMatchObject({
      website_url: "admizzeducation.com",
      widget_color: "#0D9488",
      reply_time: "in_a_few_minutes",
      pre_chat_form_enabled: true,
      allowed_domains: "https://admizzeducation.com, https://www.admizzeducation.com",
    });
    expect(channel).not.toHaveProperty("type"); // Chatwoot rejects `type` on update
    expect(channel.selected_feature_flags).not.toContain("attachments");
    expect(channel.pre_chat_form_options.pre_chat_fields.map((f) => [f.name, f.enabled, f.required])).toEqual([
      ["fullName", true, true],
      ["phoneNumber", true, true],
      ["emailAddress", true, false],
    ]);
  });

  it("does not double the www in the allowed sites", () => {
    expect(toChatwootChannel({ ...current, websiteHost: "www.example.com" }, true).allowed_domains).toBe(
      "https://example.com, https://www.example.com"
    );
  });

  it("when switched off, no website can show the bubble", () => {
    expect(toChatwootChannel(current, false).allowed_domains).toBe(CHAT_OFF_ALLOWED_DOMAINS);
  });
});

describe("toChatwootChannel dev-only extra origins", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("adds the extra local origins to the allowed sites outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("INBOX_CHATWOOT_DEV_ALLOWED_ORIGINS", "http://admizz.localhost:3001, http://localhost:3001");
    expect(toChatwootChannel(current, true).allowed_domains).toBe(
      "https://admizzeducation.com, https://www.admizzeducation.com, http://admizz.localhost:3001, http://localhost:3001"
    );
  });

  it("ignores the extra origins in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INBOX_CHATWOOT_DEV_ALLOWED_ORIGINS", "http://admizz.localhost:3001");
    expect(toChatwootChannel(current, true).allowed_domains).toBe(
      "https://admizzeducation.com, https://www.admizzeducation.com"
    );
  });

  it("drops entries that are not plain http(s) origins", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("INBOX_CHATWOOT_DEV_ALLOWED_ORIGINS", "javascript:alert(1), http://ok.localhost:3001/path, *, http://good.localhost:3001");
    expect(toChatwootChannel(current, true).allowed_domains).toBe(
      "https://admizzeducation.com, https://www.admizzeducation.com, http://good.localhost:3001"
    );
  });

  it("switched off stays fully closed even with extra origins set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("INBOX_CHATWOOT_DEV_ALLOWED_ORIGINS", "http://admizz.localhost:3001");
    expect(toChatwootChannel(current, false).allowed_domains).toBe(CHAT_OFF_ALLOWED_DOMAINS);
  });
});

describe("buildWidgetSnippet", () => {
  it("contains the server address and the token", () => {
    const snippet = buildWidgetSnippet("https://inbox.example.com", "tok123");
    expect(snippet).toContain('BASE_URL="https://inbox.example.com"');
    expect(snippet).toContain('websiteToken: "tok123"');
  });
});
