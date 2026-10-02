import { describe, it, expect } from "vitest";
import { alignStageToCountryPipeline } from "./pipeline-resolution";

// Minimal chainable fake: every .from(table) returns a builder whose filters are recorded and whose
// terminal call resolves to the next queued result for that table.
function fakeClient(results: Record<string, Array<{ data: unknown }>>) {
  const queues: Record<string, Array<{ data: unknown }>> = Object.fromEntries(
    Object.entries(results).map(([k, v]) => [k, [...v]]),
  );
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ["select", "eq", "order", "limit"]) builder[m] = chain;
      builder.maybeSingle = async () => queues[table]?.shift() ?? { data: null };
      return builder;
    },
  };
}

const args = { tenantId: "t1", stageId: "stage-india", stageSlug: "shortlisted" };

describe("alignStageToCountryPipeline", () => {
  it("leaves the stage alone when there are no countries", async () => {
    const out = await alignStageToCountryPipeline(fakeClient({}) as never, fakeClient({}) as never, { ...args, countries: undefined });
    expect(out).toEqual({ stageId: "stage-india", stageSlug: "shortlisted", pipelineId: null });
  });

  it("leaves the stage alone when no pipeline resolves for the country", async () => {
    const supabase = fakeClient({ application_pipelines: [{ data: null }, { data: null }] });
    const out = await alignStageToCountryPipeline(supabase as never, fakeClient({}) as never, { ...args, countries: ["Narnia"] });
    expect(out).toEqual({ stageId: "stage-india", stageSlug: "shortlisted", pipelineId: null });
  });

  it("keeps a stage that already belongs to the country's pipeline", async () => {
    const supabase = fakeClient({
      application_pipelines: [{ data: { id: "pipe-uk" } }],
      application_stages: [{ data: { id: "entry-uk" } }],
    });
    const db = fakeClient({ application_stages: [{ data: { id: "stage-india", pipeline_id: "pipe-uk" } }] });
    const out = await alignStageToCountryPipeline(supabase as never, db as never, { ...args, countries: ["UK"] });
    expect(out).toEqual({ stageId: "stage-india", stageSlug: "shortlisted", pipelineId: "pipe-uk" });
  });

  it("swaps a stage from another pipeline for the country's entry stage and slug", async () => {
    const supabase = fakeClient({
      application_pipelines: [{ data: { id: "pipe-uk" } }],
      application_stages: [{ data: { id: "entry-uk" } }],
    });
    const db = fakeClient({
      application_stages: [
        { data: { id: "stage-india", pipeline_id: "pipe-india" } },
        { data: { id: "entry-uk", slug: "uk-shortlisted" } },
      ],
    });
    const out = await alignStageToCountryPipeline(supabase as never, db as never, { ...args, countries: ["UK", "Canada"] });
    expect(out).toEqual({ stageId: "entry-uk", stageSlug: "uk-shortlisted", pipelineId: "pipe-uk" });
  });

  it("falls back to the default pipeline's entry stage for a country with no pipeline of its own", async () => {
    const supabase = fakeClient({
      application_pipelines: [{ data: null }, { data: { id: "pipe-default" } }],
      application_stages: [{ data: { id: "entry-default" } }],
    });
    const db = fakeClient({
      application_stages: [
        { data: { id: "stage-india", pipeline_id: "pipe-india" } },
        { data: { id: "entry-default", slug: "shortlisted-default" } },
      ],
    });
    const out = await alignStageToCountryPipeline(supabase as never, db as never, { ...args, countries: ["Atlantis"] });
    expect(out).toEqual({ stageId: "entry-default", stageSlug: "shortlisted-default", pipelineId: "pipe-default" });
  });

  it("keeps the given stage but still reports the pipeline when the entry stage row can't be read", async () => {
    const supabase = fakeClient({
      application_pipelines: [{ data: { id: "pipe-uk" } }],
      application_stages: [{ data: { id: "entry-uk" } }],
    });
    const db = fakeClient({ application_stages: [{ data: { id: "stage-india", pipeline_id: "pipe-india" } }, { data: null }] });
    const out = await alignStageToCountryPipeline(supabase as never, db as never, { ...args, countries: ["UK"] });
    expect(out).toEqual({ stageId: "stage-india", stageSlug: "shortlisted", pipelineId: "pipe-uk" });
  });
});
