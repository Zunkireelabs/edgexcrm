import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApplicationWithAccess } = vi.hoisted(() => ({ getApplicationWithAccess: vi.fn() }));
vi.mock("@/lib/api/applications", () => ({ getApplicationWithAccess }));

import { resolveApplicationLink } from "./application-link";
import type { AuthContext } from "@/lib/api/auth";

const auth = { userId: "u1", tenantId: "t1" } as unknown as AuthContext;
const LEAD = "11111111-1111-4111-8111-111111111111";
const APP = "22222222-2222-4222-8222-222222222222";
const NOTE = "33333333-3333-4333-8333-333333333333";

function db(noteRow: unknown, error: unknown = null) {
  const calls: string[][] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: (c1: string, v1: string) => ({
          eq: (c2: string, v2: string) => {
            calls.push([c1, v1, c2, v2]);
            return { maybeSingle: async () => ({ data: noteRow, error }) };
          },
        }),
      }),
    }),
  };
  return { client, calls };
}
const access = (over: Record<string, unknown> = {}) =>
  getApplicationWithAccess.mockResolvedValue({ allowed: true, viaCollaborator: false, application: { lead_id: LEAD }, ...over });

beforeEach(() => getApplicationWithAccess.mockReset());

describe("resolveApplicationLink", () => {
  it("is a no-op when no application is given (a general student document)", async () => {
    const { client } = db(null);
    expect(await resolveApplicationLink(auth, client, LEAD, undefined, undefined)).toEqual({ ok: true, applicationId: null, noteId: null });
    expect(await resolveApplicationLink(auth, client, LEAD, "", null)).toEqual({ ok: true, applicationId: null, noteId: null });
    expect(getApplicationWithAccess).not.toHaveBeenCalled();
  });

  it("accepts an application that belongs to this student", async () => {
    access();
    const { client } = db(null);
    expect(await resolveApplicationLink(auth, client, LEAD, APP, undefined)).toEqual({ ok: true, applicationId: APP, noteId: null });
  });

  it("accepts a note that belongs to that application, and looks it up by BOTH ids", async () => {
    access();
    const { client, calls } = db({ id: NOTE });
    expect(await resolveApplicationLink(auth, client, LEAD, APP, NOTE)).toEqual({ ok: true, applicationId: APP, noteId: NOTE });
    expect(calls).toEqual([["id", NOTE, "application_id", APP]]);
  });

  it("rejects malformed ids", async () => {
    const { client } = db(null);
    expect(await resolveApplicationLink(auth, client, LEAD, "nope", undefined)).toMatchObject({ ok: false, code: "VALIDATION", field: "application_id" });
    expect(await resolveApplicationLink(auth, client, LEAD, APP, "nope")).toMatchObject({ ok: false, code: "VALIDATION", field: "application_note_id" });
    expect(await resolveApplicationLink(auth, client, LEAD, 42, undefined)).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("rejects a note link with no application", async () => {
    const { client } = db(null);
    expect(await resolveApplicationLink(auth, client, LEAD, undefined, NOTE)).toMatchObject({ ok: false, code: "VALIDATION", field: "application_note_id" });
  });

  it("rejects an application that belongs to ANOTHER student", async () => {
    access({ application: { lead_id: "99999999-9999-4999-8999-999999999999" } });
    const { client } = db(null);
    const r = await resolveApplicationLink(auth, client, LEAD, APP, undefined);
    expect(r).toMatchObject({ ok: false, code: "VALIDATION", field: "application_id" });
  });

  it("treats an application the caller cannot access (or in another tenant) as not found", async () => {
    access({ allowed: false, application: null });
    const { client } = db(null);
    expect(await resolveApplicationLink(auth, client, LEAD, APP, undefined)).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("forbids a view-only collaborator from attaching", async () => {
    access({ viaCollaborator: true });
    const { client } = db(null);
    expect(await resolveApplicationLink(auth, client, LEAD, APP, undefined)).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("rejects a note that is not on that application", async () => {
    access();
    const { client } = db(null);
    expect(await resolveApplicationLink(auth, client, LEAD, APP, NOTE)).toMatchObject({ ok: false, code: "VALIDATION", field: "application_note_id" });
  });

  it("reports database failures without linking anything", async () => {
    getApplicationWithAccess.mockResolvedValue({ allowed: false, dbError: true, application: null });
    const { client } = db(null);
    expect(await resolveApplicationLink(auth, client, LEAD, APP, undefined)).toMatchObject({ ok: false, code: "DB_ERROR" });
    access();
    const failing = db(null, { message: "boom" });
    expect(await resolveApplicationLink(auth, failing.client, LEAD, APP, NOTE)).toMatchObject({ ok: false, code: "DB_ERROR" });
  });
});
