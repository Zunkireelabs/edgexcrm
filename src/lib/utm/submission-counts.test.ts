import { describe, it, expect } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import { computeSubmissionCounts, keyOf } from "./submission-counts";

type LeadRow = { intake_source: string | null; intake_medium: string | null; intake_campaign: string | null };

/**
 * Models PostgREST's real default row cap: an unpaged select silently
 * returns at most 1000 rows. Only an explicit .range() call returns a
 * different slice. This is what makes the pagination regression this file
 * guards against actually reproducible in a unit test.
 */
function makeLeadsQuery(allLeads: LeadRow[], range?: [number, number]) {
  const query = {
    is: () => query,
    range: (from: number, to: number) => makeLeadsQuery(allLeads, [from, to]),
    then: (resolve: (v: { data: LeadRow[]; error: null }) => unknown) => {
      const slice = range ? allLeads.slice(range[0], range[1] + 1) : allLeads.slice(0, 1000);
      return Promise.resolve({ data: slice, error: null }).then(resolve);
    },
  };
  return query;
}

function fakeDbWithLeads(allLeads: LeadRow[]): ScopedClient {
  return {
    from: (table: string) => {
      if (table !== "leads") throw new Error(`unexpected table ${table}`);
      return { select: () => makeLeadsQuery(allLeads) };
    },
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    raw: () => {
      throw new Error("not used in this test");
    },
  } as unknown as ScopedClient;
}

describe("computeSubmissionCounts", () => {
  it("counts a lead beyond the first 1000 rows (PostgREST's default page cap)", async () => {
    const filler: LeadRow[] = Array.from({ length: 1000 }, () => ({
      intake_source: "old-source",
      intake_medium: null,
      intake_campaign: null,
    }));
    // Row #1001 — a plain unpaged select would never see this row at all.
    const recentLead: LeadRow = {
      intake_source: "standee",
      intake_medium: null,
      intake_campaign: "offline-standee-campaign",
    };

    const db = fakeDbWithLeads([...filler, recentLead]);
    const links = [{ utm_source: "standee", utm_medium: null, utm_campaign: "offline-standee-campaign" }];

    const counts = await computeSubmissionCounts(db, links);

    expect(counts.get(keyOf("standee", null, "offline-standee-campaign"))).toBe(1);
  });

  it("returns an empty map when there are no saved links", async () => {
    const db = fakeDbWithLeads([]);
    const counts = await computeSubmissionCounts(db, []);
    expect(counts.size).toBe(0);
  });

  it("normalizes case, whitespace, and null/blank medium the same way as the link's stored values", async () => {
    const db = fakeDbWithLeads([
      { intake_source: "  Standee  ", intake_medium: "", intake_campaign: "Offline-Standee-Campaign" },
    ]);
    const links = [{ utm_source: "standee", utm_medium: null, utm_campaign: "offline-standee-campaign" }];

    const counts = await computeSubmissionCounts(db, links);

    expect(counts.get(keyOf("standee", null, "offline-standee-campaign"))).toBe(1);
  });

  it("skips leads with no attribution on any of the three fields", async () => {
    const db = fakeDbWithLeads([{ intake_source: null, intake_medium: null, intake_campaign: null }]);
    const links = [{ utm_source: "standee", utm_medium: null, utm_campaign: "offline-standee-campaign" }];

    const counts = await computeSubmissionCounts(db, links);

    expect(counts.size).toBe(0);
  });
});
