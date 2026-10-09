// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyDocumentsChanged, onDocumentsChanged } from "./documents-events";

const unsubs: (() => void)[] = [];
afterEach(() => { unsubs.splice(0).forEach((u) => u()); });
const subscribe = (leadId: string, cb: () => void) => { const u = onDocumentsChanged(leadId, cb); unsubs.push(u); return u; };

describe("documents changed signal", () => {
  it("tells a listener for the same student", () => {
    const cb = vi.fn();
    subscribe("lead-1", cb);
    notifyDocumentsChanged("lead-1");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("ignores changes to a different student's documents", () => {
    const cb = vi.fn();
    subscribe("lead-1", cb);
    notifyDocumentsChanged("lead-2");
    expect(cb).not.toHaveBeenCalled();
  });

  it("stops after unsubscribing", () => {
    const cb = vi.fn();
    const off = subscribe("lead-1", cb);
    off();
    notifyDocumentsChanged("lead-1");
    expect(cb).not.toHaveBeenCalled();
  });

  it("reaches every listener for that student (two cards on one page)", () => {
    const a = vi.fn(); const b = vi.fn();
    subscribe("lead-1", a); subscribe("lead-1", b);
    notifyDocumentsChanged("lead-1");
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
  });
});
