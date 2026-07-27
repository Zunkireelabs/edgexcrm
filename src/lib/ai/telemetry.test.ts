import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const traceMock = vi.fn();
const spanMock = vi.fn();
const spanEndMock = vi.fn();
const generationMock = vi.fn();
const updateMock = vi.fn();
const flushAsyncMock = vi.fn().mockResolvedValue(undefined);
const scoreMock = vi.fn();
const LangfuseCtor = vi.fn().mockImplementation(() => ({
  trace: traceMock.mockReturnValue({
    span: spanMock.mockReturnValue({ end: spanEndMock }),
    generation: generationMock,
    update: updateMock,
  }),
  flushAsync: flushAsyncMock,
  score: scoreMock,
}));

vi.mock("langfuse", () => ({
  Langfuse: LangfuseCtor,
}));

describe("telemetry", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    LangfuseCtor.mockClear();
    traceMock.mockClear();
    spanMock.mockClear();
    spanEndMock.mockClear();
    generationMock.mockClear();
    updateMock.mockClear();
    flushAsyncMock.mockClear();
    scoreMock.mockClear();
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

  it("scoreRun no-ops (no throw, no client, no score/flush) when keys are unset", async () => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;

    const { scoreRun } = await import("./telemetry");
    expect(() => scoreRun("r1", "output_produced", 1)).not.toThrow();
    expect(LangfuseCtor).not.toHaveBeenCalled();
    expect(scoreMock).not.toHaveBeenCalled();
    expect(flushAsyncMock).not.toHaveBeenCalled();
  });

  describe("with keys set", () => {
    beforeEach(() => {
      process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
      process.env.LANGFUSE_SECRET_KEY = "sk-test";
    });

    it("constructs the client with a mask function every time — masking can't be bypassed", async () => {
      const { startTrace } = await import("./telemetry");
      startTrace({ runId: "run-1", tenantId: "tenant-1", industryId: null, surface: "assistant" });

      expect(LangfuseCtor).toHaveBeenCalledWith(expect.objectContaining({ mask: expect.any(Function) }));
    });

    it("creates a trace and opens a real span (not a point event) with a startTime", async () => {
      const { startTrace } = await import("./telemetry");
      const trace = startTrace({
        runId: "run-1",
        tenantId: "tenant-1",
        userId: "user-1",
        industryId: "it_agency",
        surface: "assistant",
      });

      expect(traceMock).toHaveBeenCalledWith(expect.objectContaining({ id: "run-1", userId: "user-1", tags: ["assistant"] }));

      trace.span("chat.start", { toolCount: 3 });
      expect(spanMock).toHaveBeenCalledWith({ name: "chat.start", input: { toolCount: 3 }, startTime: expect.any(Date) });

      trace.end({ ok: true, inputTokens: 10, outputTokens: 20 });
      // The open span closes with the end() data as its output — a real duration.
      expect(spanEndMock).toHaveBeenCalledWith({ output: { ok: true, inputTokens: 10, outputTokens: 20 } });
      expect(updateMock).toHaveBeenCalledWith({ output: { ok: true, inputTokens: 10, outputTokens: 20 }, tags: ["assistant"] });
      // after() has no request scope in this test — falls back to direct flush.
      expect(flushAsyncMock).toHaveBeenCalledTimes(1);
    });

    it("closes a still-open span when a second span() checkpoint fires, so neither is left dangling", async () => {
      const { startTrace } = await import("./telemetry");
      const trace = startTrace({ runId: "run-1", tenantId: "tenant-1", industryId: null, surface: "ingestion" });

      trace.span("kb-ingest.start", { itemId: "item-1" });
      trace.span("kb-ingest.done", { itemId: "item-1", chunkCount: 4 });
      trace.end({ ok: true, chunkCount: 4 });

      expect(spanMock).toHaveBeenCalledTimes(2);
      expect(spanEndMock).toHaveBeenCalledTimes(2);
      // First span closes with no output when the second checkpoint opens.
      expect(spanEndMock).toHaveBeenNthCalledWith(1, undefined);
      // Second span closes with end()'s data as its output.
      expect(spanEndMock).toHaveBeenNthCalledWith(2, { output: { ok: true, chunkCount: 4 } });
    });

    it("attaches model + usage to a generation so Langfuse can price it, only when both are present", async () => {
      const { startTrace } = await import("./telemetry");
      const trace = startTrace({ runId: "run-1", tenantId: "tenant-1", industryId: null, surface: "assistant" });

      trace.span("chat.start");
      trace.end({ ok: true, model: "gpt-4o-mini", inputTokens: 120, outputTokens: 340 });

      expect(generationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4o-mini",
          usage: { input: 120, output: 340, unit: "TOKENS" },
          startTime: expect.any(Date),
          endTime: expect.any(Date),
        }),
      );
    });

    it("does not create a generation for tool calls (no model/usage)", async () => {
      const { startTrace } = await import("./telemetry");
      const trace = startTrace({ runId: "run-1", tenantId: "tenant-1", industryId: null, surface: "assistant" });

      trace.span("tool:search_leads", { input: { query: "test" } });
      trace.end({ ok: true });

      expect(generationMock).not.toHaveBeenCalled();
    });

    it("tags a failed tool call as an error, filterable per tool id", async () => {
      const { startTrace } = await import("./telemetry");
      const trace = startTrace({ runId: "run-1", tenantId: "tenant-1", industryId: null, surface: "assistant" });

      trace.span("tool:search_leads", { input: { query: "test" } });
      trace.end({ ok: false });

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ tags: expect.arrayContaining(["assistant", "error", "tool-error:search_leads"]) }),
      );
    });

    it("tags degraded retrieval and step-budget exhaustion so both are filterable", async () => {
      const { startTrace } = await import("./telemetry");

      const retrievalTrace = startTrace({ runId: "run-2", tenantId: "tenant-1", industryId: null, surface: "retrieval" });
      retrievalTrace.span("retrieve", { degraded: true });
      retrievalTrace.end({ ok: true });
      expect(updateMock).toHaveBeenLastCalledWith(expect.objectContaining({ tags: expect.arrayContaining(["degraded"]) }));

      const chatTrace = startTrace({ runId: "run-3", tenantId: "tenant-1", industryId: null, surface: "assistant" });
      chatTrace.span("chat.start");
      chatTrace.end({ ok: true, stepBudgetExhausted: true });
      expect(updateMock).toHaveBeenLastCalledWith(expect.objectContaining({ tags: expect.arrayContaining(["step-budget-exhausted"]) }));
    });

    describe("mask()", () => {
      function getMaskFn(): (params: { data: unknown }) => unknown {
        const opts = LangfuseCtor.mock.calls.at(-1)?.[0] as { mask: (params: { data: unknown }) => unknown };
        return opts.mask;
      }

      it("masks name/email/phone/free-text values while keeping ids, tool names, and counts", async () => {
        const { startTrace } = await import("./telemetry");
        startTrace({ runId: "run-1", tenantId: "tenant-1", industryId: null, surface: "assistant" });
        const mask = getMaskFn();

        const result = mask({
          data: {
            input: {
              first_name: "Manisha",
              last_name: "Rai",
              email: "manisha@example.com",
              phone: "+977-9800000000",
              query: "find Manisha Rai",
              assignedToUserId: "b6e6f7d2-1c2b-4a3e-9c1a-000000000001",
              limit: 20,
            },
          },
        }) as { input: Record<string, unknown> };

        expect(result.input.first_name).toBe("[masked]");
        expect(result.input.last_name).toBe("[masked]");
        expect(result.input.email).toBe("[masked]");
        expect(result.input.phone).toBe("[masked]");
        expect(result.input.query).toBe("[masked]");
        // ids and counts survive untouched.
        expect(result.input.assignedToUserId).toBe("b6e6f7d2-1c2b-4a3e-9c1a-000000000001");
        expect(result.input.limit).toBe(20);
      });

      it("masks at every level of a nested/deep object, not just the top", async () => {
        const { startTrace } = await import("./telemetry");
        startTrace({ runId: "run-1", tenantId: "tenant-1", industryId: null, surface: "assistant" });
        const mask = getMaskFn();

        const result = mask({
          data: { filters: { contact: { email: "deep@example.com", leadId: "eef51732-1fbf-485a-89fc-2777b9097985" } } },
        }) as { filters: { contact: { email: string; leadId: string } } };

        expect(result.filters.contact.email).toBe("[masked]");
        // UUID-shaped id survives even several levels deep.
        expect(result.filters.contact.leadId).toBe("eef51732-1fbf-485a-89fc-2777b9097985");
      });

      it("masks id-shaped keys whose value isn't a UUID — passport/national/citizenship ids are the regression that matters here", async () => {
        const { startTrace } = await import("./telemetry");
        startTrace({ runId: "run-1", tenantId: "tenant-1", industryId: null, surface: "assistant" });
        const mask = getMaskFn();

        // An education consultancy CRM handles student visa/admission data —
        // passport and national ID numbers are the most sensitive PII in the
        // system, and they're shaped as `*_id`/`*Id` keys just like opaque
        // UUID record ids. The key name alone must never be enough to unmask.
        const result = mask({
          data: {
            national_id: "123456789",
            passport_id: "N1234567",
            citizenship_id: "CIT-98765",
            studentId: "STU-2026-0042",
          },
        }) as Record<string, unknown>;

        expect(result.national_id).toBe("[masked]");
        expect(result.passport_id).toBe("[masked]");
        expect(result.citizenship_id).toBe("[masked]");
        expect(result.studentId).toBe("[masked]");
      });

      it("keeps id-shaped keys whose value is UUID-shaped, and display_id as an explicit safe key", async () => {
        const { startTrace } = await import("./telemetry");
        startTrace({ runId: "run-1", tenantId: "tenant-1", industryId: null, surface: "assistant" });
        const mask = getMaskFn();

        const result = mask({
          data: {
            leadId: "eef51732-1fbf-485a-89fc-2777b9097985",
            tenantId: "b6e6f7d2-1c2b-4a3e-9c1a-000000000001",
            id: "0f701658-eafc-4ba2-aa42-aa5dce4de370",
            display_id: "ADM-001",
          },
        }) as Record<string, unknown>;

        expect(result.leadId).toBe("eef51732-1fbf-485a-89fc-2777b9097985");
        expect(result.tenantId).toBe("b6e6f7d2-1c2b-4a3e-9c1a-000000000001");
        expect(result.id).toBe("0f701658-eafc-4ba2-aa42-aa5dce4de370");
        expect(result.display_id).toBe("ADM-001");
      });

      it("keeps operational fields — booleans, enums, model ids, tenant/user/industry ids, surface", async () => {
        const { startTrace } = await import("./telemetry");
        startTrace({ runId: "run-1", tenantId: "tenant-1", industryId: null, surface: "assistant" });
        const mask = getMaskFn();

        const result = mask({
          data: {
            ok: true,
            degraded: false,
            model: "gpt-4o-mini",
            tenantId: "tenant-1",
            userId: "user-1",
            industryId: "it_agency",
            surface: "assistant",
            status: "approved",
          },
        }) as Record<string, unknown>;

        expect(result).toEqual({
          ok: true,
          degraded: false,
          model: "gpt-4o-mini",
          tenantId: "tenant-1",
          userId: "user-1",
          industryId: "it_agency",
          surface: "assistant",
          status: "approved",
        });
      });

      it("fails closed to a placeholder — never emits unmasked data — when masking itself throws", async () => {
        const { startTrace } = await import("./telemetry");
        startTrace({ runId: "run-1", tenantId: "tenant-1", industryId: null, surface: "assistant" });
        const mask = getMaskFn();

        const evil: Record<string, unknown> = {};
        Object.defineProperty(evil, "boom", {
          enumerable: true,
          get() {
            throw new Error("hostile getter");
          },
        });

        expect(mask({ data: evil })).toBe("[mask error]");
      });
    });

    it("scoreRun calls score with correct args and schedules a flush when keys are set", async () => {
      process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
      process.env.LANGFUSE_SECRET_KEY = "sk-test";

      const { scoreRun } = await import("./telemetry");
      scoreRun("r1", "review_outcome", 0.5, "decision=edited_accepted;kind=draft_email");

      expect(scoreMock).toHaveBeenCalledOnce();
      expect(scoreMock).toHaveBeenCalledWith({
        traceId: "r1",
        name: "review_outcome",
        value: 0.5,
        comment: "decision=edited_accepted;kind=draft_email",
      });
      // after() has no request scope in this test — falls back to direct flush.
      expect(flushAsyncMock).toHaveBeenCalledTimes(1);
    });
  });
});
