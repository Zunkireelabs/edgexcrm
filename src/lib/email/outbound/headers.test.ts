import { describe, it, expect } from "vitest";
import { buildBulkEmailHeaders } from "./headers";

describe("buildBulkEmailHeaders", () => {
  it("emits RFC 8058 List-Unsubscribe + one-click headers", () => {
    const headers = buildBulkEmailHeaders("https://edgex.zunkireelabs.com/e/u/aB3dEf9k1x");
    expect(headers["List-Unsubscribe"]).toBe(
      "<https://edgex.zunkireelabs.com/e/u/aB3dEf9k1x>, <mailto:unsubscribe@edgex.zunkireelabs.com>"
    );
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});
