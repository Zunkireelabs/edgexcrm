import { describe, it, expect } from "vitest";
import { isTimerStopped } from "./stop-result";

describe("isTimerStopped", () => {
  it("treats a 200 OK response as stopped", () => {
    expect(isTimerStopped({ ok: true, status: 200 })).toBe(true);
  });

  it("treats a 409 ALREADY_STOPPED response as stopped, not stuck", () => {
    // Regression: a row's stop control used to clear its running state only
    // on res.ok, so a 409 from a timer someone else already stopped left the
    // button permanently rendering "stop" — every further click just 409'd
    // again with no way out short of a page refresh.
    expect(isTimerStopped({ ok: false, status: 409 })).toBe(true);
  });

  it("does not treat other error statuses as stopped", () => {
    expect(isTimerStopped({ ok: false, status: 500 })).toBe(false);
    expect(isTimerStopped({ ok: false, status: 404 })).toBe(false);
  });
});
