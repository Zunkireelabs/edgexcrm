import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let tokenRows: Row[];
let tenantRows: Row[];
let suppressionInserts: Row[];

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(async () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {};
      return {
        select: () => ({
          eq(col: string, val: unknown) {
            filters[col] = val;
            return this;
          },
          maybeSingle: async () => {
            const rows = table === "email_unsubscribe_tokens" ? tokenRows : [];
            const match = rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
            return { data: match ?? null, error: null };
          },
          single: async () => {
            const rows = table === "tenants" ? tenantRows : [];
            const match = rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
            return { data: match ?? null, error: match ? null : { message: "not found" } };
          },
        }),
        update: (values: Row) => ({
          eq: async (col: string, val: unknown) => {
            const target = tokenRows.find((r) => r[col] === val);
            if (target) Object.assign(target, values);
            return { data: null, error: null };
          },
        }),
      };
    },
  })),
}));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClientForTenant: vi.fn(async (tenantId: string) => ({
    from(table: string) {
      return {
        upsert: async (rows: Row) => {
          if (table === "email_suppressions") suppressionInserts.push({ ...rows, tenant_id: tenantId });
          return { data: null, error: null };
        },
      };
    },
  })),
}));

import { GET, POST } from "./route";

function ctx(token: string) {
  return { params: Promise.resolve({ token }) };
}

beforeEach(() => {
  tokenRows = [];
  tenantRows = [{ id: "tenant-a", name: "Admizz Education" }];
  suppressionInserts = [];
});

describe("GET /api/public/email/unsubscribe/[token]", () => {
  it("never mutates — an unknown token returns a neutral invalid response, not a 404", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(new Request("https://x/api/public/email/unsubscribe/bogus") as any, ctx("bogus"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.valid).toBe(false);
    expect(suppressionInserts).toHaveLength(0);
  });

  it("a valid token returns tenant name + masked email, and does not suppress", async () => {
    tokenRows = [{ token: "tok1", tenant_id: "tenant-a", email: "student@example.com", lead_id: null, used_at: null }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(new Request("https://x/api/public/email/unsubscribe/tok1") as any, ctx("tok1"));
    const body = await res.json();
    expect(body.data.valid).toBe(true);
    expect(body.data.tenantName).toBe("Admizz Education");
    expect(body.data.maskedEmail).toMatch(/@example\.com$/);
    expect(body.data.maskedEmail).not.toBe("student@example.com");
    expect(suppressionInserts).toHaveLength(0); // GET NEVER mutates
  });
});

describe("POST /api/public/email/unsubscribe/[token]", () => {
  it("suppresses the email and marks the token used", async () => {
    tokenRows = [{ token: "tok2", tenant_id: "tenant-a", email: "student@example.com", lead_id: "lead-1", used_at: null }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(new Request("https://x/api/public/email/unsubscribe/tok2", { method: "POST" }) as any, ctx("tok2"));
    const body = await res.json();
    expect(body.data.valid).toBe(true);
    expect(body.data.unsubscribed).toBe(true);
    expect(suppressionInserts).toHaveLength(1);
    expect(suppressionInserts[0]).toMatchObject({ email: "student@example.com", reason: "unsubscribe", lead_id: "lead-1" });
    expect(tokenRows[0].used_at).toBeDefined();
  });

  it("used_at is a record, not a gate — a token already used works again", async () => {
    tokenRows = [
      { token: "tok3", tenant_id: "tenant-a", email: "student@example.com", lead_id: null, used_at: "2026-01-01T00:00:00.000Z" },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(new Request("https://x/api/public/email/unsubscribe/tok3", { method: "POST" }) as any, ctx("tok3"));
    const body = await res.json();
    expect(body.data.valid).toBe(true);
    expect(suppressionInserts).toHaveLength(1);
  });

  it("an unknown token returns the same neutral response as GET", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(new Request("https://x/api/public/email/unsubscribe/bogus", { method: "POST" }) as any, ctx("bogus"));
    const body = await res.json();
    expect(body.data.valid).toBe(false);
    expect(suppressionInserts).toHaveLength(0);
  });
});
