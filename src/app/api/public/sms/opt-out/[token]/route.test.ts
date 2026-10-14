import { beforeEach, describe, expect, it, vi } from "vitest";

// The public SMS opt-out link. GET must NEVER opt anyone out (carrier scanners fetch every URL). POST suppresses the
// number AND ends the lead's running SMS sequence(s) — and a failure while ending the sequence must never undo the opt-out.

const suppressMock = vi.fn();
const stopMock = vi.fn();
let tokenRow: Record<string, unknown> | null;
const tokenUpdates: unknown[] = [];

vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }), logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/sms/suppression", () => ({ suppressPhone: (...a: unknown[]) => suppressMock(...a) }));
vi.mock("@/industries/_shared/features/outreach/lib/stop-on-sms-optout", () => ({ stopSmsEnrollmentsForLead: (...a: unknown[]) => stopMock(...a) }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: async () => ({ marker: "scoped" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: (table: string) => {
      if (table === "tenants") return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: "Admizz" } }) }) }) };
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tokenRow, error: null }) }) }),
        update: (patch: unknown) => ({
          eq: async () => {
            tokenUpdates.push(patch);
            return { error: null };
          },
        }),
      };
    },
  }),
}));

import { GET, POST } from "./route";
import type { NextRequest } from "next/server";

const ctx = { params: Promise.resolve({ token: "TOKEN12345" }) };
const row = { token: "TOKEN12345", tenant_id: "t1", phone_e164: "+9779801234567", lead_id: "lead-1", used_at: null };

beforeEach(() => {
  suppressMock.mockReset().mockResolvedValue(undefined);
  stopMock.mockReset().mockResolvedValue({ ended: 1 });
  tokenUpdates.length = 0;
  tokenRow = row;
});

describe("SMS opt-out link", () => {
  it("GET never opts anyone out", async () => {
    const res = await GET({} as NextRequest, ctx);
    expect((await res.json()).data).toMatchObject({ valid: true });
    expect(suppressMock).not.toHaveBeenCalled();
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("POST suppresses the number and ends the lead's SMS sequence", async () => {
    const res = await POST({} as NextRequest, ctx);
    expect((await res.json()).data).toMatchObject({ valid: true, optedOut: true });
    expect(suppressMock).toHaveBeenCalledWith(expect.anything(), "t1", expect.objectContaining({ phoneE164: "+9779801234567", reason: "opt_out", leadId: "lead-1" }));
    expect(stopMock).toHaveBeenCalledWith(expect.anything(), { tenantId: "t1", leadId: "lead-1", reason: "opt_out" });
  });

  it("a link with no lead still opts the number out (nothing to end)", async () => {
    tokenRow = { ...row, lead_id: null };
    expect((await POST({} as NextRequest, ctx)).status).toBe(200);
    expect(suppressMock).toHaveBeenCalled();
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("if ending the sequence fails, the opt-out still stands and the person still sees it succeed", async () => {
    stopMock.mockRejectedValue(new Error("db down"));
    const res = await POST({} as NextRequest, ctx);
    expect((await res.json()).data).toMatchObject({ optedOut: true });
    expect(suppressMock).toHaveBeenCalled();
  });

  it("an unknown token is a neutral 'not valid' — nothing is suppressed or ended", async () => {
    tokenRow = null;
    const res = await POST({} as NextRequest, ctx);
    expect((await res.json()).data).toMatchObject({ valid: false });
    expect(suppressMock).not.toHaveBeenCalled();
    expect(stopMock).not.toHaveBeenCalled();
  });
});
