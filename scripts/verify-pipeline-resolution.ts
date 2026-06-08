/**
 * Throwaway verification harness for resolveLeadPipelineAndStage().
 * Stubs the Supabase client with an in-memory dataset — touches NO real DB.
 * Run: npx tsx scripts/verify-pipeline-resolution.ts
 *
 * Proves every branch of the resolver against the 3-step algorithm in
 * docs/FORMS-API-AUDIT-BRIEF.md P0 #1. Delete after Step 1 is merged.
 */
import { resolveLeadPipelineAndStage } from "../src/lib/leads/pipeline-resolution";

// ── In-memory dataset ──────────────────────────────────────────────
// t1 = the tenant under test. t2 = a second tenant (cross-tenant probes).
// t_empty = a tenant with no pipelines (no-default probe).
const pipelines = [
  { id: "pdef", tenant_id: "t1", is_default: true },
  { id: "pcat", tenant_id: "t1", is_default: false },
  { id: "pempty", tenant_id: "t1", is_default: false }, // exists but has zero stages
  { id: "pother", tenant_id: "t2", is_default: true },  // belongs to another tenant
];
const pipeline_stages = [
  { id: "sdef_new", pipeline_id: "pdef", tenant_id: "t1", slug: "new", is_default: true, position: 0 },
  { id: "sdef_contacted", pipeline_id: "pdef", tenant_id: "t1", slug: "contacted", is_default: false, position: 1 },
  { id: "scat_entry", pipeline_id: "pcat", tenant_id: "t1", slug: "requested", is_default: true, position: 0 },
  { id: "scat_sent", pipeline_id: "pcat", tenant_id: "t1", slug: "sent", is_default: false, position: 1 },
];
const DB: Record<string, Record<string, unknown>[]> = { pipelines, pipeline_stages };

// ── Minimal chainable fake matching the calls the resolver makes ────
function makeClient(db: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const eqs: [string, unknown][] = [];
      const orders: [string, boolean][] = [];
      const builder = {
        select() { return builder; },
        eq(col: string, val: unknown) { eqs.push([col, val]); return builder; },
        order(col: string, opts?: { ascending?: boolean }) { orders.push([col, opts?.ascending !== false]); return builder; },
        limit() { return builder; },
        async maybeSingle() {
          let rows = (db[table] ?? []).filter((r) => eqs.every(([c, v]) => r[c] === v));
          // apply order keys in reverse so the first .order() is the primary (stable sort)
          for (const [c, asc] of [...orders].reverse()) {
            rows = rows.slice().sort((a, b) => {
              const an = typeof a[c] === "boolean" ? (a[c] ? 1 : 0) : (a[c] as number);
              const bn = typeof b[c] === "boolean" ? (b[c] ? 1 : 0) : (b[c] as number);
              return asc ? (an > bn ? 1 : an < bn ? -1 : 0) : (an < bn ? 1 : an > bn ? -1 : 0);
            });
          }
          return { data: rows[0] ?? null, error: null };
        },
        async single() { return builder.maybeSingle(); },
      };
      return builder;
    },
  } as never;
}

const client = makeClient(DB);

type Case = { name: string; args: Parameters<typeof resolveLeadPipelineAndStage>[1]; expect: Record<string, unknown> };

const cases: Case[] = [
  { name: "1  ModeA routed (status 'new' not in target → entry)", args: { tenantId: "t1", formConfig: { id: "f1", target_pipeline_id: "pcat" }, statusSlug: "new", strictStatus: false }, expect: { ok: true, pipelineId: "pcat", stageId: "scat_entry", statusSlug: "requested" } },
  { name: "2  ModeA non-routed → default", args: { tenantId: "t1", formConfig: { id: "f2", target_pipeline_id: null }, statusSlug: "new" }, expect: { ok: true, pipelineId: "pdef", stageId: "sdef_new", statusSlug: "new" } },
  { name: "3  ModeA partial step (status 'partial' → target entry, no hop)", args: { tenantId: "t1", formConfig: { id: "f1", target_pipeline_id: "pcat" }, statusSlug: "partial" }, expect: { ok: true, pipelineId: "pcat", stageId: "scat_entry", statusSlug: "requested" } },
  { name: "4  ModeB routed → target entry", args: { tenantId: "t1", formConfig: { id: "f1", target_pipeline_id: "pcat" } }, expect: { ok: true, pipelineId: "pcat", stageId: "scat_entry", statusSlug: "requested" } },
  { name: "5  ModeB non-routed → default entry", args: { tenantId: "t1", formConfig: { id: "f2", target_pipeline_id: null } }, expect: { ok: true, pipelineId: "pdef", stageId: "sdef_new", statusSlug: "new" } },
  { name: "6  ModeC bare (no stage/status) → default (pipeline NON-NULL = bug fix)", args: { tenantId: "t1" }, expect: { ok: true, pipelineId: "pdef", stageId: "sdef_new", statusSlug: "new" } },
  { name: "7  ModeC valid stage_id → pipeline derived from stage", args: { tenantId: "t1", explicitStageId: "scat_sent" }, expect: { ok: true, pipelineId: "pcat", stageId: "scat_sent", statusSlug: "sent" } },
  { name: "8  ModeC bogus status (strict) → invalid_status", args: { tenantId: "t1", statusSlug: "bogus", strictStatus: true }, expect: { ok: false, reason: "invalid_status" } },
  { name: "9  explicit pipeline override beats form target", args: { tenantId: "t1", explicitPipelineId: "pcat", formConfig: { id: "f3", target_pipeline_id: "pdef" }, statusSlug: "new" }, expect: { ok: true, pipelineId: "pcat", stageId: "scat_entry", statusSlug: "requested" } },
  { name: "10 explicit pipeline cross-tenant → ignored, falls to target", args: { tenantId: "t1", explicitPipelineId: "pother", formConfig: { id: "f1", target_pipeline_id: "pcat" }, statusSlug: "new" }, expect: { ok: true, pipelineId: "pcat", stageId: "scat_entry", statusSlug: "requested" } },
  { name: "11 target has no stages → warn + fall to default", args: { tenantId: "t1", formConfig: { id: "f4", target_pipeline_id: "pempty" }, statusSlug: "new" }, expect: { ok: true, pipelineId: "pdef", stageId: "sdef_new", statusSlug: "new" } },
  { name: "12 target cross-tenant (not found) → fall to default", args: { tenantId: "t1", formConfig: { id: "f5", target_pipeline_id: "pother" }, statusSlug: "new" }, expect: { ok: true, pipelineId: "pdef", stageId: "sdef_new", statusSlug: "new" } },
  { name: "13 invalid stage_id → invalid_stage", args: { tenantId: "t1", explicitStageId: "nope" }, expect: { ok: false, reason: "invalid_stage" } },
  { name: "14 no default pipeline → no_pipeline", args: { tenantId: "t_empty" }, expect: { ok: false, reason: "no_pipeline" } },
  { name: "15 lenient status match within target", args: { tenantId: "t1", formConfig: { id: "f6", target_pipeline_id: "pcat" }, statusSlug: "sent", strictStatus: false }, expect: { ok: true, pipelineId: "pcat", stageId: "scat_sent", statusSlug: "sent" } },
  { name: "16 ModeC strict status that matches in default", args: { tenantId: "t1", statusSlug: "contacted", strictStatus: true }, expect: { ok: true, pipelineId: "pdef", stageId: "sdef_contacted", statusSlug: "contacted" } },
];

async function main() {
  let failed = 0;
  for (const c of cases) {
    // eslint-disable-next-line no-await-in-loop
    const got = await resolveLeadPipelineAndStage(client, c.args);
    const ok = JSON.stringify(got) === JSON.stringify(c.expect);
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
    if (!ok) {
      console.log(`        expected: ${JSON.stringify(c.expect)}`);
      console.log(`        got:      ${JSON.stringify(got)}`);
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
}
void main();
