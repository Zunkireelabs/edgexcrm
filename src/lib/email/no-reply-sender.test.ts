import { describe, it, expect, vi, beforeEach } from "vitest";

// resolveNoReplySender: when may the no-reply address be offered, and what does the template look like. No database (faked).

interface Cfg {
  settings: Record<string, unknown> | null;
  tenant: Record<string, unknown> | null;
  throws?: boolean;
}
const cfg = vi.hoisted(() => ({ current: null as unknown as Cfg }));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => {
    if (cfg.current.throws) throw new Error("db down");
    return {
      from(table: string) {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.maybeSingle = async () => ({ data: table === "tenant_email_settings" ? cfg.current.settings : cfg.current.tenant, error: null });
        return b;
      },
    };
  },
}));

import { resolveNoReplySender } from "./no-reply-sender";

const GOOD_SETTINGS = {
  from_name: "Admizz Education",
  from_address: "hello@mail.admizz.com",
  reply_to: "hello@admizz.com",
  domain_verified: true,
  no_reply_address: "no-reply@mail.admizz.com",
  template_color: "#0D1282",
  template_accent: "#FDED22",
  template_logo_url: null,
};
const GOOD_TENANT = { name: "Admizz Education Pvt", logo_url: "https://cdn.example.com/logo.png", primary_color: "#2272B4" };

beforeEach(() => {
  cfg.current = { settings: { ...GOOD_SETTINGS }, tenant: { ...GOOD_TENANT } };
});

describe("resolveNoReplySender", () => {
  it("offers the no-reply address with the company's look when everything is in place", async () => {
    expect(await resolveNoReplySender("t1")).toEqual({
      sender: { from: "Admizz Education <no-reply@mail.admizz.com>", address: "no-reply@mail.admizz.com", name: "Admizz Education", replyTo: "hello@admizz.com" },
      brand: { name: "Admizz Education", logoUrl: "https://cdn.example.com/logo.png", color: "#0D1282", accent: "#FDED22", helpEmail: "hello@admizz.com" },
    });
  });

  it("is not offered when the company domain is not verified", async () => {
    cfg.current.settings = { ...GOOD_SETTINGS, domain_verified: false };
    expect(await resolveNoReplySender("t1")).toBeNull();
  });

  it("is not offered when no address was set, or it is not an email", async () => {
    for (const no_reply_address of [null, "", "no-reply", "a b@mail.admizz.com"]) {
      cfg.current.settings = { ...GOOD_SETTINGS, no_reply_address };
      expect(await resolveNoReplySender("t1")).toBeNull();
    }
  });

  it("is not offered when the company address itself is missing or invalid", async () => {
    for (const from_address of [null, "", "nope"]) {
      cfg.current.settings = { ...GOOD_SETTINGS, from_address };
      expect(await resolveNoReplySender("t1")).toBeNull();
    }
  });

  it("is not offered for an address on a DIFFERENT domain than the verified company address", async () => {
    cfg.current.settings = { ...GOOD_SETTINGS, no_reply_address: "no-reply@other-domain.com" };
    expect(await resolveNoReplySender("t1")).toBeNull();
    cfg.current.settings = { ...GOOD_SETTINGS, no_reply_address: "no-reply@mail.admizz.com.evil.io" };
    expect(await resolveNoReplySender("t1")).toBeNull();
  });

  it("compares the domain ignoring case", async () => {
    cfg.current.settings = { ...GOOD_SETTINGS, no_reply_address: "No-Reply@MAIL.Admizz.COM" };
    expect((await resolveNoReplySender("t1"))?.sender.address).toBe("No-Reply@MAIL.Admizz.COM");
  });

  it("is not offered when it is the very same address as the company address", async () => {
    cfg.current.settings = { ...GOOD_SETTINGS, no_reply_address: "HELLO@mail.admizz.com" };
    expect(await resolveNoReplySender("t1")).toBeNull();
  });

  it("takes the colour from the template setting, else the tenant brand colour, else none", async () => {
    cfg.current.settings = { ...GOOD_SETTINGS, template_color: null, template_accent: null };
    expect((await resolveNoReplySender("t1"))?.brand).toMatchObject({ color: "#2272B4", accent: null });
    cfg.current.tenant = { ...GOOD_TENANT, primary_color: null };
    expect((await resolveNoReplySender("t1"))?.brand.color).toBeNull();
  });

  it("falls back to the tenant name, then EdgeX, for the display name; strips header-breaking characters", async () => {
    cfg.current.settings = { ...GOOD_SETTINGS, from_name: null };
    expect((await resolveNoReplySender("t1"))?.sender.name).toBe("Admizz Education Pvt");
    cfg.current.tenant = { ...GOOD_TENANT, name: null };
    expect((await resolveNoReplySender("t1"))?.sender.name).toBe("EdgeX");
    cfg.current.settings = { ...GOOD_SETTINGS, from_name: "Ad<miz>z\r\nBcc: x@y.z" };
    expect((await resolveNoReplySender("t1"))?.sender.from).toBe("AdmizzBcc: x@y.z <no-reply@mail.admizz.com>");
  });

  it("the layout's own logo link wins; otherwise the company logo; otherwise none", async () => {
    cfg.current.settings = { ...GOOD_SETTINGS, template_logo_url: "https://edgex.zunkireelabs.com/email/admizz-logo.jpg" };
    expect((await resolveNoReplySender("t1"))?.brand.logoUrl).toBe("https://edgex.zunkireelabs.com/email/admizz-logo.jpg");
    cfg.current.settings = { ...GOOD_SETTINGS, template_logo_url: null };
    expect((await resolveNoReplySender("t1"))?.brand.logoUrl).toBe("https://cdn.example.com/logo.png");
    cfg.current.settings = { ...GOOD_SETTINGS, template_logo_url: "" };
    cfg.current.tenant = { ...GOOD_TENANT, logo_url: null };
    expect((await resolveNoReplySender("t1"))?.brand.logoUrl).toBeNull();
  });

  it("no help address when the team Reply-To is not set or invalid; the logo may be missing", async () => {
    cfg.current.settings = { ...GOOD_SETTINGS, reply_to: "not-an-email" };
    cfg.current.tenant = { ...GOOD_TENANT, logo_url: null };
    const r = await resolveNoReplySender("t1");
    expect(r?.sender.replyTo).toBeNull();
    expect(r?.brand).toMatchObject({ helpEmail: null, logoUrl: null });
  });

  it("works when the tenant row cannot be read (uses the settings only)", async () => {
    cfg.current.tenant = null;
    expect((await resolveNoReplySender("t1"))?.brand).toMatchObject({ name: "Admizz Education", logoUrl: null, color: "#0D1282" });
  });

  it("never throws: a database failure just means not offered", async () => {
    cfg.current.throws = true;
    expect(await resolveNoReplySender("t1")).toBeNull();
  });

  it("no settings row at all: not offered", async () => {
    cfg.current.settings = null;
    expect(await resolveNoReplySender("t1")).toBeNull();
  });
});
