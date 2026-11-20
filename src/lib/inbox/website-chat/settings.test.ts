import { describe, it, expect, afterEach, vi } from "vitest";
import {
  buildWidgetSnippet,
  DEFAULT_OFFICE_HOURS,
  toChatwootInbox,
  withSettingDefaults,
  contrastWithWhite,
  normalizeHexColor,
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

describe("custom colour", () => {
  it("normalizes hex colours and refuses anything else", () => {
    expect(normalizeHexColor("#001353")).toBe("#001353");
    expect(normalizeHexColor("001353")).toBe("#001353");
    expect(normalizeHexColor(" #abc ")).toBe("#AABBCC");
    expect(normalizeHexColor("#12345")).toBeNull();
    expect(normalizeHexColor("red")).toBeNull();
    expect(normalizeHexColor("javascript:1")).toBeNull();
  });

  it("calculates the contrast of white text", () => {
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 0);
    expect(contrastWithWhite("#FFFFFF")).toBeCloseTo(1, 1);
    expect(contrastWithWhite("#001353")).toBeCloseTo(17.2, 1);
    expect(contrastWithWhite("#FDED22")).toBeCloseTo(1.2, 1);
  });

  it("accepts a dark custom colour, stores it normalized, and sends it to Chatwoot", () => {
    const result = mergeWebsiteChatSettings(current, { color: "001353" });
    expect(result).toMatchObject({ ok: true, settings: { color: "#001353" } });
    if (!result.ok) throw new Error("expected ok");
    expect(toChatwootChannel(result.settings, true).widget_color).toBe("#001353");
  });

  it("refuses a custom colour too light for white text, and says why", () => {
    const result = mergeWebsiteChatSettings(current, { color: "#FDED22" });
    expect(result).toMatchObject({ ok: false, errors: { color: [expect.stringContaining("too light")] } });
  });

  it("falls back to the first listed colour when a stored custom colour is no longer valid", () => {
    expect(toChatwootChannel({ ...current, color: "#FDED22" }, true).widget_color).toBe("#1F93FF");
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

describe("office hours", () => {
  it("are off by default, so the chat shows as online until an admin sets real hours", () => {
    expect(DEFAULT_OFFICE_HOURS.enabled).toBe(false);
    expect(current.officeHours.enabled).toBe(false);
  });

  it("accepts valid hours and keeps what was not sent", () => {
    const result = mergeWebsiteChatSettings(current, { officeHours: { enabled: true, timezone: "Asia/Kathmandu", days: [1, 3, 2, 2], open: "10:00", close: "18:30" } });
    expect(result).toMatchObject({
      ok: true,
      settings: { officeHours: { enabled: true, timezone: "Asia/Kathmandu", days: [1, 2, 3], open: "10:00", close: "18:30" } },
    });
    const partial = mergeWebsiteChatSettings(current, { officeHours: { open: "08:00" } });
    expect(partial).toMatchObject({ ok: true, settings: { officeHours: { ...DEFAULT_OFFICE_HOURS, open: "08:00" } } });
  });

  it("does not change the current settings object it was given", () => {
    mergeWebsiteChatSettings(current, { officeHours: { enabled: true, days: [0] } });
    expect(current.officeHours.days).toEqual(DEFAULT_OFFICE_HOURS.days);
    expect(current.officeHours.enabled).toBe(false);
  });

  it.each([
    [{ timezone: "Mars/Olympus" }, "time zones"],
    [{ days: [7] }, "Days"],
    [{ days: "mon" }, "Days"],
    [{ open: "9am" }, "open time"],
    [{ close: "24:00" }, "close time"],
    [{ enabled: "yes" }, "on/off"],
    [{ enabled: true, open: "18:00", close: "09:00" }, "after the opening"],
    [{ enabled: true, days: [] }, "at least one day"],
  ])("refuses %j", (officeHours, fragment) => {
    const result = mergeWebsiteChatSettings(current, { officeHours });
    expect(result).toMatchObject({ ok: false, errors: { officeHours: [expect.stringContaining(fragment)] } });
  });

  it("refuses office hours that are not an object", () => {
    expect(mergeWebsiteChatSettings(current, { officeHours: "9-5" })).toMatchObject({ ok: false });
  });

  it("allows an empty day list while hours are off (nothing to enforce)", () => {
    expect(mergeWebsiteChatSettings(current, { officeHours: { days: [] } })).toMatchObject({ ok: true });
  });
});

describe("toChatwootInbox", () => {
  it("names the inbox after the chat title, because that is the header on the form screen", () => {
    expect(toChatwootInbox({ ...current, title: "Chat with Admizz" }).name).toBe("Chat with Admizz");
  });

  it("describes all 7 days, closed on the days not chosen", () => {
    const inbox = toChatwootInbox({ ...current, officeHours: { enabled: true, timezone: "Asia/Kathmandu", days: [1], open: "09:05", close: "17:45" } });
    expect(inbox).toMatchObject({ working_hours_enabled: true, timezone: "Asia/Kathmandu" });
    expect(inbox.working_hours.map((d) => d.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(inbox.working_hours[1]).toEqual({ day_of_week: 1, closed_all_day: false, open_all_day: false, open_hour: 9, open_minutes: 5, close_hour: 17, close_minutes: 45 });
    expect(inbox.working_hours.filter((d) => d.closed_all_day)).toHaveLength(6);
  });

  it("survives settings saved before office hours existed", () => {
    const { officeHours: _omitted, ...old } = current;
    void _omitted;
    expect(toChatwootInbox(old as never)).toMatchObject({ working_hours_enabled: false });
  });
});

describe("withSettingDefaults", () => {
  it("fills in office hours and any missing field for older saved settings", () => {
    const { officeHours: _omitted, ...old } = current;
    void _omitted;
    const filled = withSettingDefaults(old);
    expect(filled.officeHours).toEqual(DEFAULT_OFFICE_HOURS);
    expect(filled.websiteHost).toBe("admizzeducation.com");
  });
});
