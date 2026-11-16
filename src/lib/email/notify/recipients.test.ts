import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
import { resolveRecipients } from "./recipients";
import type { NotifyDb } from "./types";

function fakeDb(members: { user_id: string; role: string }[] | null, emails: Record<string, string | null>, calls: { roles?: string[] } = {}): NotifyDb {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = (_col: string, roles: string[]) => {
    calls.roles = roles;
    return Promise.resolve({ data: members, error: members ? null : { message: "boom" } });
  };
  return {
    from: () => chain,
    auth: {
      admin: {
        getUserById: (id: string) =>
          Promise.resolve({ data: { user: emails[id] === undefined ? null : { email: emails[id], user_metadata: { full_name: `Name ${id}` } } }, error: null }),
      },
    },
  } as unknown as NotifyDb;
}

describe("resolveRecipients", () => {
  it("asks only for the requested roles and returns lower-cased emails with names", async () => {
    const calls: { roles?: string[] } = {};
    const out = await resolveRecipients(fakeDb([{ user_id: "a", role: "owner" }], { a: "Boss@X.com" }, calls), "t1", ["owner", "admin"]);
    expect(calls.roles).toEqual(["owner", "admin"]);
    expect(out).toEqual([{ userId: "a", email: "boss@x.com", name: "Name a" }]);
  });
  it("de-duplicates by email and skips members with no email", async () => {
    const out = await resolveRecipients(
      fakeDb([{ user_id: "a", role: "owner" }, { user_id: "b", role: "admin" }, { user_id: "c", role: "admin" }], { a: "same@x.com", b: "SAME@x.com", c: null }),
      "t1",
      ["owner", "admin"]
    );
    expect(out.map((r) => r.email)).toEqual(["same@x.com"]);
  });
  it("returns [] (never throws) when the member lookup fails", async () => {
    expect(await resolveRecipients(fakeDb(null, {}), "t1", ["owner"])).toEqual([]);
  });
});
