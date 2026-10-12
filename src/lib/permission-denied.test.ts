import { describe, expect, it } from "vitest";
import { PERMISSION_DENIED_MESSAGE, failureMessage } from "./permission-denied";

describe("failureMessage", () => {
  it("returns the standard no-permission message for 403", () => {
    expect(failureMessage({ status: 403 }, "Failed to update fee")).toBe(PERMISSION_DENIED_MESSAGE);
  });

  it.each([400, 404, 500])("keeps the screen's own message for %i", (status) => {
    expect(failureMessage({ status }, "Failed to update fee")).toBe("Failed to update fee");
  });
});
