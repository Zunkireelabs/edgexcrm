import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./deps", () => ({ realAiReplyDeps: () => ({}) }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { createAiReplyScheduler } from "./scheduler";
import type { AiReplyResult } from "./run";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ev = (conversationId = "c1") => ({ tenantId: "t1", conversationId });
const answered: AiReplyResult = { done: "answered" };

describe("AI reply scheduler", () => {
  it("runs once, after the quiet period, not before", async () => {
    const run = vi.fn().mockResolvedValue(answered);
    const s = createAiReplyScheduler({ run, debounceMs: 5000 });
    s.schedule(ev());
    await vi.advanceTimersByTimeAsync(4999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(ev());
  });

  it("a burst of messages restarts the timer and gets ONE run", async () => {
    const run = vi.fn().mockResolvedValue(answered);
    const s = createAiReplyScheduler({ run, debounceMs: 5000 });
    s.schedule(ev());
    await vi.advanceTimersByTimeAsync(3000);
    s.schedule(ev());
    await vi.advanceTimersByTimeAsync(3000);
    s.schedule(ev());
    await vi.advanceTimersByTimeAsync(4999);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("different chats are independent", async () => {
    const run = vi.fn().mockResolvedValue(answered);
    const s = createAiReplyScheduler({ run, debounceMs: 1000 });
    s.schedule(ev("a"));
    s.schedule(ev("b"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.mock.calls.map((c) => c[0].conversationId).sort()).toEqual(["a", "b"]);
  });

  it("never runs a chat twice at once: a message that arrives mid-run queues exactly one more run afterwards", async () => {
    let release!: () => void;
    const run = vi.fn().mockImplementationOnce(() => new Promise<AiReplyResult>((r) => (release = () => r(answered)))).mockResolvedValue(answered);
    const s = createAiReplyScheduler({ run, debounceMs: 1000 });
    s.schedule(ev());
    await vi.advanceTimersByTimeAsync(1000);          // first run starts and is "thinking"
    expect(s.running()).toBe(1);
    s.schedule(ev());
    await vi.advanceTimersByTimeAsync(1000);          // timer fires while the first run is still going
    expect(run).toHaveBeenCalledTimes(1);             // ...but it did not start a second concurrent run
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);          // the queued run, after its own quiet period
    expect(run).toHaveBeenCalledTimes(2);
    expect(s.running()).toBe(0);
  });

  it("when the answer was dropped because the visitor wrote again, runs again to answer the whole burst", async () => {
    const run = vi.fn().mockResolvedValueOnce({ done: "skipped", reason: "newer_message" }).mockResolvedValue(answered);
    const s = createAiReplyScheduler({ run, debounceMs: 1000 });
    s.schedule(ev());
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not run again after an ordinary skip or an answer", async () => {
    const run = vi.fn().mockResolvedValue({ done: "skipped", reason: "human_owns_chat" });
    const s = createAiReplyScheduler({ run, debounceMs: 1000 });
    s.schedule(ev());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a failing run is logged and dropped, and the next message still works", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(answered);
    const s = createAiReplyScheduler({ run, debounceMs: 1000 });
    s.schedule(ev());
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.running()).toBe(0);
    s.schedule(ev());
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
