import { describe, it, expect } from "vitest";
import { displayName } from "./people";

describe("displayName", () => {
  it("prefers the profile name", () => expect(displayName(" Esha Rai ", "e@x.com")).toBe("Esha Rai"));
  it("falls back to the email local part in title case", () => {
    expect(displayName(null, "counselor@admizz.local")).toBe("Counselor");
    expect(displayName("", "anil.kc@admizz.org")).toBe("Anil Kc");
  });
  it("is Unknown with neither", () => expect(displayName(undefined, null)).toBe("Unknown"));
});
