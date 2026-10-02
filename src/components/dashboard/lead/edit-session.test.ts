import { describe, expect, it } from "vitest";
import { createEditRegistry } from "./edit-session";

describe("createEditRegistry", () => {
  it("returns an empty patch when nothing is registered", () => {
    expect(createEditRegistry().collectPatch()).toEqual({});
  });

  it("merges the patches of every section that changed something", () => {
    const registry = createEditRegistry();
    registry.register("study", { getPatch: () => ({ field_of_study: "Law", intake_term: "May 2027" }) });
    registry.register("source", { getPatch: () => ({ intake_source: "Referral" }) });

    expect(registry.collectPatch()).toEqual({
      field_of_study: "Law",
      intake_term: "May 2027",
      intake_source: "Referral",
    });
  });

  it("skips sections that report no change (null)", () => {
    const registry = createEditRegistry();
    registry.register("study", { getPatch: () => null });
    registry.register("source", { getPatch: () => ({ intake_source: "Referral" }) });

    expect(registry.collectPatch()).toEqual({ intake_source: "Referral" });
  });

  it("returns an empty patch when every section is untouched", () => {
    const registry = createEditRegistry();
    registry.register("study", { getPatch: () => null });
    registry.register("source", { getPatch: () => null });

    expect(registry.collectPatch()).toEqual({});
  });

  it("stops asking a section once it unregisters", () => {
    const registry = createEditRegistry();
    const unregister = registry.register("study", { getPatch: () => ({ field_of_study: "Law" }) });
    unregister();

    expect(registry.collectPatch()).toEqual({});
  });

  it("lets a newer registration under the same id replace the old one", () => {
    const registry = createEditRegistry();
    registry.register("study", { getPatch: () => ({ field_of_study: "Old" }) });
    registry.register("study", { getPatch: () => ({ field_of_study: "New" }) });

    expect(registry.collectPatch()).toEqual({ field_of_study: "New" });
  });

  it("does not let a stale unregister remove a newer registration", () => {
    const registry = createEditRegistry();
    const unregisterOld = registry.register("study", { getPatch: () => ({ field_of_study: "Old" }) });
    registry.register("study", { getPatch: () => ({ field_of_study: "New" }) });
    unregisterOld();

    expect(registry.collectPatch()).toEqual({ field_of_study: "New" });
  });

  it("reads each section's patch fresh on every collect", () => {
    const registry = createEditRegistry();
    let value = "A";
    registry.register("study", { getPatch: () => ({ field_of_study: value }) });

    expect(registry.collectPatch()).toEqual({ field_of_study: "A" });
    value = "B";
    expect(registry.collectPatch()).toEqual({ field_of_study: "B" });
  });
});
