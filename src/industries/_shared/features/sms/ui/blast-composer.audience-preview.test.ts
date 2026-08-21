// Regression guard for the Phase 3 audience-UX brief
// (docs/SMS-PHASE4-PHASE3-BRIEF.md) Piece A: formatAudienceCountLine() picks
// the right rendered clause for the persistent count line depending on
// whether sample names are available.

import { describe, it, expect } from "vitest";
import { formatAudienceCountLine } from "./blast-composer";

describe("formatAudienceCountLine — Phase 3 Piece A", () => {
  it("includes an 'incl.' clause with a '+N more' suffix when matched exceeds the sample", () => {
    const line = formatAudienceCountLine({
      matched: 261,
      sendable: 250,
      sampleNames: ["Gaurav Dahal", "Puja Basnet", "Aarav Tamang"],
    });
    expect(line).toBe("250 sendable of 261 matched — incl. Gaurav Dahal, Puja Basnet, Aarav Tamang, +258 more.");
  });

  it("omits the '+N more' suffix when the sample covers every matched lead", () => {
    const line = formatAudienceCountLine({ matched: 1, sendable: 1, sampleNames: ["Gaurav Dahal"] });
    expect(line).toBe("1 sendable of 1 matched — incl. Gaurav Dahal.");
  });

  it("falls back to the plain text with no 'incl.' clause when there are no sample names", () => {
    const line = formatAudienceCountLine({ matched: 4, sendable: 4, sampleNames: [] });
    expect(line).toBe("4 sendable of 4 matched leads.");
  });
});
