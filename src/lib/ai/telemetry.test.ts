import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const traceMock = vi.fn();
const eventMock = vi.fn();
const updateMock = vi.fn();
const flushAsyncMock = vi.fn().mockResolvedValue(undefined);

vi.mock("langfuse", () => ({
  Langfuse: vi.fn().mockImplementation(() => ({
    trace: traceMock.mockReturnValue({ event: eventMock, update: updateMock }),
    flushAsync: flushAsyncMock,
  })),
}));

describe("telemetry", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    traceMock.mockClear();
    eventMock.mockClear();
    updateMock.mockClear();
    flushAsyncMock.mockClear();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("no-ops (no Langfuse client, no throw) when keys are unset", async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;

    const { startTrace } = await import("./telemetry");
    const trace = startTrace({ runId: "r1", tenantId: "t1", industryId: null, surface: "assistant" });

    expect(() => trace.span("chat.start")).not.toThrow();
    expect(() => trace.end({ ok: true })).not.toThrow();
    expect(traceMock).not.toHaveBeenCalled();
    expect(flushAsyncMock).not.toHaveBeenCalled();
  });

  it("creates a Langfuse trace and forwards span/end when keys are set", async () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";

    const { startTrace } = await import("./telemetry");
    const trace = startTrace({
      runId: "run-1",
      tenantId: "tenant-1",
      userId: "user-1",
      industryId: "it_agency",
      surface: "assistant",
    });

    expect(traceMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run-1", userId: "user-1", tags: ["assistant"] })
    );

    trace.span("chat.start", { toolCount: 3 });
    expect(eventMock).toHaveBeenCalledWith({ name: "chat.start", input: { toolCount: 3 } });

    trace.end({ ok: true, inputTokens: 10, outputTokens: 20 });
    expect(updateMock).toHaveBeenCalledWith({ output: { ok: true, inputTokens: 10, outputTokens: 20 } });
    // after() has no request scope in this test — falls back to direct flush.
    expect(flushAsyncMock).toHaveBeenCalledTimes(1);
  });
});
