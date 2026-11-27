import { describe, it, expect, vi, beforeEach } from "vitest";

// resolveVerifiedCompanySender: "may a person pick the company address as their From?" — yes only for a
// custom address on a VERIFIED domain, never the shared platform address, never throwing.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any> | null;
let settingsRow: Row = null;
let shouldThrow = false;

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => {
    if (shouldThrow) throw new Error("db down");
    return {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: settingsRow, error: null }) }) }),
      }),
    };
  },
}));

import { resolveVerifiedCompanySender } from "./sender";

beforeEach(() => {
  settingsRow = null;
  shouldThrow = false;
});

describe("resolveVerifiedCompanySender", () => {
  it("returns the sender for a verified custom address", async () => {
    settingsRow = { from_name: "Admizz Education", from_address: "hello@mail.admizz.com", reply_to: "hello@admizz.com", domain_verified: true };
    expect(await resolveVerifiedCompanySender("t")).toEqual({
      from: "Admizz Education <hello@mail.admizz.com>",
      address: "hello@mail.admizz.com",
      name: "Admizz Education",
      replyTo: "hello@admizz.com",
    });
  });

  it("is null when the domain is NOT verified — never offers an address we can't send from", async () => {
    settingsRow = { from_name: "Admizz", from_address: "hello@mail.admizz.com", reply_to: null, domain_verified: false };
    expect(await resolveVerifiedCompanySender("t")).toBeNull();
  });

  it("is null when there is no settings row, no from_address, or a malformed one", async () => {
    expect(await resolveVerifiedCompanySender("t")).toBeNull();
    settingsRow = { from_name: "A", from_address: null, reply_to: null, domain_verified: true };
    expect(await resolveVerifiedCompanySender("t")).toBeNull();
    settingsRow = { from_name: "A", from_address: "not-an-email", reply_to: null, domain_verified: true };
    expect(await resolveVerifiedCompanySender("t")).toBeNull();
  });

  it("never throws: a database failure just means no company option", async () => {
    shouldThrow = true;
    await expect(resolveVerifiedCompanySender("t")).resolves.toBeNull();
  });

  it("strips header-breaking characters from the display name and defaults it to EdgeX", async () => {
    settingsRow = { from_name: 'Ad<mi>zz\r\nBcc: x@evil.com', from_address: "hello@mail.admizz.com", reply_to: null, domain_verified: true };
    const s = await resolveVerifiedCompanySender("t");
    expect(s!.name).not.toMatch(/[<>\r\n]/);
    expect(s!.from.split("\n")).toHaveLength(1);

    settingsRow = { from_name: null, from_address: "hello@mail.admizz.com", reply_to: null, domain_verified: true };
    expect((await resolveVerifiedCompanySender("t"))!.name).toBe("EdgeX");
  });

  it("ignores an invalid Reply-To rather than failing", async () => {
    settingsRow = { from_name: "A", from_address: "hello@mail.admizz.com", reply_to: "garbage", domain_verified: true };
    expect((await resolveVerifiedCompanySender("t"))!.replyTo).toBeNull();
  });
});
