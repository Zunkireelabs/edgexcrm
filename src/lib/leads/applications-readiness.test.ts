import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/leads/profile-completeness", () => ({
  checkLeadProfileCompleteness: vi.fn(),
}));

import { checkLeadProfileCompleteness } from "@/lib/leads/profile-completeness";
import {
  isFeeEntered,
  checkApplicationsReadiness,
  applicationsGateMessage,
} from "./applications-readiness";

const profile = vi.mocked(checkLeadProfileCompleteness);

// Minimal chainable stub: every table resolves to a canned row.
function fakeDb(rows: { fee?: string | null; templateActive?: boolean | null; signed?: boolean }) {
  return {
    from(table: string) {
      const result =
        table === "leads"
          ? { pre_app_fee_status: rows.fee ?? null }
          : table === "consent_templates"
          ? rows.templateActive == null ? null : { is_active: rows.templateActive }
          : table === "lead_consents"
          ? rows.signed ? { id: "c1" } : null
          : null;
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "limit"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: result });
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("isFeeEntered", () => {
  it.each(["claimed", "paid", "waiver"])("%s counts (no admin verification needed for claimed)", (s) => {
    expect(isFeeEntered(s)).toBe(true);
  });
  it.each([null, undefined, "", "unpaid"])("%s does not count", (s) => {
    expect(isFeeEntered(s as string | null | undefined)).toBe(false);
  });
});

describe("checkApplicationsReadiness", () => {
  it("ready when fee claimed, profile complete, consent signed", async () => {
    profile.mockResolvedValue({ complete: true, missing: [] });
    const r = await checkApplicationsReadiness(fakeDb({ fee: "claimed", templateActive: true, signed: true }), "t", "l");
    expect(r).toEqual({ ready: true, missing: [] });
  });

  it("reports every missing item", async () => {
    profile.mockResolvedValue({ complete: false, missing: ["Phone"] });
    const r = await checkApplicationsReadiness(fakeDb({ fee: "unpaid", templateActive: true, signed: false }), "t", "l");
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(["Processing fee", "Basic info (Phone)", "Consent signed"]);
  });

  it("an admin-rejected fee (unpaid) blocks again", async () => {
    profile.mockResolvedValue({ complete: true, missing: [] });
    const r = await checkApplicationsReadiness(fakeDb({ fee: "unpaid", templateActive: false }), "t", "l");
    expect(r.missing).toEqual(["Processing fee"]);
  });

  it("skips the consent check when the tenant has no active template", async () => {
    profile.mockResolvedValue({ complete: true, missing: [] });
    const r = await checkApplicationsReadiness(fakeDb({ fee: "paid", templateActive: null }), "t", "l");
    expect(r.ready).toBe(true);
  });

  it("consent and basic info stay strict even when the fee is only claimed", async () => {
    profile.mockResolvedValue({ complete: false, missing: ["a document"] });
    const r = await checkApplicationsReadiness(fakeDb({ fee: "claimed", templateActive: true, signed: false }), "t", "l");
    expect(r.missing).toEqual(["Basic info (a document)", "Consent signed"]);
  });
});

describe("same-request values (fee / basic info sent together with the stage move)", () => {
  it("a fee sent in the same request counts even though the stored fee is empty", async () => {
    profile.mockResolvedValue({ complete: true, missing: [] });
    const r = await checkApplicationsReadiness(
      fakeDb({ fee: null, templateActive: false }), "t", "l", { pre_app_fee_status: "claimed" },
    );
    expect(r.ready).toBe(true);
  });

  it("a fee sent in the same request that is NOT acceptable still blocks, even if the stored fee was fine", async () => {
    profile.mockResolvedValue({ complete: true, missing: [] });
    const r = await checkApplicationsReadiness(
      fakeDb({ fee: "paid", templateActive: false }), "t", "l", { pre_app_fee_status: "unpaid" },
    );
    expect(r.missing).toEqual(["Processing fee"]);
  });

  it("falls back to the stored fee when the request does not carry one", async () => {
    profile.mockResolvedValue({ complete: true, missing: [] });
    const r = await checkApplicationsReadiness(fakeDb({ fee: "paid", templateActive: false }), "t", "l", { phone: "123" });
    expect(r.ready).toBe(true);
  });

  it("hands the pending values to the basic-info check", async () => {
    profile.mockClear();
    profile.mockResolvedValue({ complete: true, missing: [] });
    const pending = { phone: "+977-9800000000" };
    await checkApplicationsReadiness(fakeDb({ fee: "paid", templateActive: false }), "t", "l", pending);
    expect(profile).toHaveBeenCalledWith(expect.anything(), "t", "l", pending);
  });
});

describe("applicationsGateMessage", () => {
  it("lists what is missing", () => {
    expect(applicationsGateMessage(["Processing fee", "Consent signed"])).toBe(
      "Before moving to Applications, complete: Processing fee, Consent signed.",
    );
  });
});
