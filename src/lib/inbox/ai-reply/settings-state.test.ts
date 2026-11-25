import { describe, it, expect, vi, afterEach } from "vitest";
import { loadAiReplyCardState } from "./settings-state";

afterEach(() => vi.unstubAllEnvs());

const db = (meta: unknown) => {
  const queried = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = { select: () => b, eq: (...a: unknown[]) => (queried(...a), b), maybeSingle: async () => ({ data: meta === undefined ? null : { meta } }) };
  return { client: { from: () => b } as never, queried };
};
const envOn = () => {
  vi.stubEnv("INBOX_AI_REPLY_ENABLED", "true");
  vi.stubEnv("ZUNKIREE_SEARCH_URL", "https://api.example.com");
  vi.stubEnv("ZUNKIREE_SEARCH_KEY", "k");
};

describe("loadAiReplyCardState", () => {
  it("is unavailable (and asks the database nothing) for other industries or when the server is not set up", async () => {
    envOn();
    const other = db({});
    expect(await loadAiReplyCardState(other.client, "t1", "it_agency")).toEqual({ available: false, enabled: false, siteId: "" });
    expect(other.queried).not.toHaveBeenCalled();
    vi.stubEnv("INBOX_AI_REPLY_ENABLED", "false");
    expect((await loadAiReplyCardState(db({}).client, "t1", "education_consultancy")).available).toBe(false);
  });
  it("returns the saved setting for Admizz, scoped to the tenant", async () => {
    envOn();
    const d = db({ website_chat_ai: { enabled: true, siteId: "admizz-edu" } });
    expect(await loadAiReplyCardState(d.client, "t1", "education_consultancy")).toEqual({ available: true, enabled: true, siteId: "admizz-edu" });
    expect(d.queried).toHaveBeenCalledWith("tenant_id", "t1");
  });
  it("is available but off when nothing is saved yet", async () => {
    envOn();
    expect(await loadAiReplyCardState(db({}).client, "t1", "education_consultancy")).toEqual({ available: true, enabled: false, siteId: "" });
  });
});
