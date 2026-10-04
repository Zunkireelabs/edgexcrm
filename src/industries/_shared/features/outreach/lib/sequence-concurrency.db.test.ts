import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { localRawClient } from "@/lib/email/outbound/test-support";
import { requireLocalDbInCi } from "@/lib/test-support/require-db-in-ci";

// DB-backed (REAL Postgres via the local Supabase stack — skips cleanly when it isn't up; a hard failure in CI's
// "Test (database-backed)" job). Pins the two review findings on PR #604 against the real database, where the unit
// tests' fake databases cannot see a race:
//   - switch_lead_enrollment: "Switch" ends the old enrollment AND starts the new one in ONE transaction, so a lead is
//     never left in no sequence;
//   - apply_sequence_steps + the draft version check: editing a running sequence is serialised with draft creation.

const db = localRawClient();
const RUN = Math.floor(Math.random() * 900000 + 100000);

let available = false;
let tenantId: string;
let pipelineId: string;
const leadIds: string[] = [];
const sequenceIds: string[] = [];

beforeAll(async () => {
  try {
    const { data: t, error } = await db.from("tenants").select("id").limit(1).single();
    if (error || !t) return;
    tenantId = t.id;
    const { data: p } = await db.from("pipelines").select("id").eq("tenant_id", tenantId).limit(1).single();
    if (!p) return;
    pipelineId = p.id;
    available = true;
  } catch {
    // Local Supabase stack not running.
  }
}, 5000);

beforeAll(() => requireLocalDbInCi(available, "outreach sequence concurrency"));

afterAll(async () => {
  if (!available) return;
  if (sequenceIds.length) await db.from("email_sequences").delete().in("id", sequenceIds); // cascades steps, enrollments, drafts
  if (leadIds.length) await db.from("leads").delete().in("id", leadIds);
});

async function newLead(tag: string): Promise<string> {
  const { data, error } = await db
    .from("leads")
    .insert({ tenant_id: tenantId, pipeline_id: pipelineId, first_name: "Conc", last_name: tag, email: `conc-${RUN}-${tag}@zunkiree.invalid` })
    .select("id")
    .single();
  if (error || !data) throw new Error(`lead fixture failed: ${error?.message}`);
  leadIds.push(data.id);
  return data.id;
}

const step = (n: number, delay: number, text = "t", sendTime = "") => ({
  step_order: n, delay_days: delay, send_time: sendTime, subject_template: `s${n}-${text}`, body_template: `b${n}-${text}`, draft_source: "template", ai_instructions: null,
});

async function newSequence(name: string, steps = [step(1, 0), step(2, 2), step(3, 3), step(4, 4)]): Promise<string> {
  const { data, error } = await db.from("email_sequences").insert({ tenant_id: tenantId, name: `conc-${RUN}-${name}` }).select("id").single();
  if (error || !data) throw new Error(`sequence fixture failed: ${error?.message}`);
  sequenceIds.push(data.id);
  const { error: applyError } = await db.rpc("apply_sequence_steps", { p_tenant_id: tenantId, p_sequence_id: data.id, p_steps: steps });
  if (applyError) throw new Error(`steps fixture failed: ${applyError.message}`);
  return data.id;
}

async function enroll(sequenceId: string, leadId: string, currentStep = 0) {
  const { data, error } = await db
    .from("sequence_enrollments")
    .insert({ tenant_id: tenantId, sequence_id: sequenceId, lead_id: leadId, status: "active", current_step_order: currentStep })
    .select("id")
    .single();
  if (error || !data) throw new Error(`enrollment fixture failed: ${error?.message}`);
  return data.id as string;
}

const runningFor = async (leadId: string) => {
  const { data } = await db.from("sequence_enrollments").select("id, sequence_id, status").eq("tenant_id", tenantId).eq("lead_id", leadId).in("status", ["active", "paused"]);
  return data ?? [];
};

const switchArgs = (leadId: string, oldId: string, seqId: string) => ({
  p_tenant_id: tenantId, p_lead_id: leadId, p_old_enrollment_id: oldId, p_sequence_id: seqId, p_assigned_to: null, p_enrolled_by: null,
});

describe("switch_lead_enrollment — one transaction", () => {
  it("ends the old enrollment (and skips its pending drafts) and starts the new one", async (ctx) => {
    if (!available) return ctx.skip();
    const [a, b] = [await newSequence("sw-a"), await newSequence("sw-b")];
    const lead = await newLead("sw1");
    const old = await enroll(a, lead);
    await db.from("sequence_step_drafts").insert({ tenant_id: tenantId, enrollment_id: old, lead_id: lead, step_order: 1, status: "pending" });

    const { data: newId, error } = await db.rpc("switch_lead_enrollment", switchArgs(lead, old, b));
    expect(error).toBeNull();

    const running = await runningFor(lead);
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ id: newId, sequence_id: b });
    const { data: oldRow } = await db.from("sequence_enrollments").select("status").eq("id", old).single();
    expect(oldRow?.status).toBe("unenrolled");
    const { data: drafts } = await db.from("sequence_step_drafts").select("status").eq("enrollment_id", old);
    expect(drafts?.map((d) => d.status)).toEqual(["skipped"]);
  });

  it("if the new enrollment cannot be created the OLD one is NOT ended — the lead is never left in no sequence", async (ctx) => {
    if (!available) return ctx.skip();
    const [a, b] = [await newSequence("rb-a"), await newSequence("rb-b")];
    const lead = await newLead("rb1");
    const current = await enroll(a, lead);

    // "someone else got there in between": the caller's idea of the old enrollment is stale, so nothing is ended
    // and the insert hits the one-running-sequence-per-lead index
    const stale = "00000000-0000-0000-0000-000000000000";
    const { error } = await db.rpc("switch_lead_enrollment", switchArgs(lead, stale, b));
    expect(error?.code).toBe("23505");

    const running = await runningFor(lead);
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ id: current, sequence_id: a, status: "active" });
  });

  it("two switches for the same lead at the same moment: exactly one wins, the lead is in exactly one sequence", async (ctx) => {
    if (!available) return ctx.skip();
    const [a, b, c] = [await newSequence("par-a"), await newSequence("par-b"), await newSequence("par-c")];
    for (let i = 0; i < 8; i++) {
      const lead = await newLead(`par${i}`);
      const old = await enroll(a, lead);

      const [r1, r2] = await Promise.all([
        db.rpc("switch_lead_enrollment", switchArgs(lead, old, b)),
        db.rpc("switch_lead_enrollment", switchArgs(lead, old, c)),
      ]);

      expect([r1.error, r2.error].filter(Boolean)).toHaveLength(1); // one wins, one is refused
      const running = await runningFor(lead);
      expect(running).toHaveLength(1);
      expect([b, c]).toContain(running[0].sequence_id);
    }
  });

  it("refuses a sequence that belongs to another tenant", async (ctx) => {
    if (!available) return ctx.skip();
    const a = await newSequence("tn-a");
    const lead = await newLead("tn1");
    const old = await enroll(a, lead);
    const { error } = await db.rpc("switch_lead_enrollment", { ...switchArgs(lead, old, a), p_tenant_id: "99999999-9999-9999-9999-999999999999" });
    expect(error).not.toBeNull();
    expect(await runningFor(lead)).toHaveLength(1);
  });
});

describe("apply_sequence_steps — locked steps and the version stamp", () => {
  it("refuses to change a step leads have reached (STEPS_LOCKED, hint = how many) and changes nothing", async (ctx) => {
    if (!available) return ctx.skip();
    const seq = await newSequence("ed-lock");
    await enroll(seq, await newLead("ed1"), 2); // a lead has handled step 2 -> steps 1..3 are in use

    const { error } = await db.rpc("apply_sequence_steps", {
      p_tenant_id: tenantId, p_sequence_id: seq, p_steps: [step(1, 0), step(2, 2), step(3, 9), step(4, 4)],
    });
    expect(error?.message).toContain("STEPS_LOCKED");
    expect(error?.hint).toBe("3");

    const { data } = await db.from("email_sequence_steps").select("step_order, delay_days").eq("sequence_id", seq).order("step_order");
    expect(data?.map((s) => s.delay_days)).toEqual([0, 2, 3, 4]);
  });

  it("allows new wording on a reached step and any change after them; bumps the version", async (ctx) => {
    if (!available) return ctx.skip();
    const seq = await newSequence("ed-ok");
    await enroll(seq, await newLead("ed2"), 2);
    const before = (await db.from("email_sequences").select("steps_version").eq("id", seq).single()).data!.steps_version as number;

    const { error } = await db.rpc("apply_sequence_steps", {
      p_tenant_id: tenantId, p_sequence_id: seq, p_steps: [step(1, 0, "new"), step(2, 2, "new"), step(3, 3, "new"), step(4, 12, "new", "15:30"), step(5, 5)],
    });
    expect(error).toBeNull();

    const { data } = await db.from("email_sequence_steps").select("step_order, delay_days, send_time, subject_template").eq("sequence_id", seq).order("step_order");
    expect(data?.map((s) => s.step_order)).toEqual([1, 2, 3, 4, 5]);
    expect(data?.[0].subject_template).toBe("s1-new");
    expect(data?.[3]).toMatchObject({ delay_days: 12, send_time: "15:30" });
    const after = (await db.from("email_sequences").select("steps_version").eq("id", seq).single()).data!.steps_version as number;
    expect(after).toBe(before + 1);
  });

  it("removing a step nobody reached works, removing one a lead reached is refused", async (ctx) => {
    if (!available) return ctx.skip();
    const seq = await newSequence("ed-rm");
    await enroll(seq, await newLead("ed3"), 1); // steps 1..2 in use
    const base = { p_tenant_id: tenantId, p_sequence_id: seq };
    expect((await db.rpc("apply_sequence_steps", { ...base, p_steps: [step(1, 0), step(2, 2), step(3, 3)] })).error).toBeNull();
    expect((await db.rpc("apply_sequence_steps", { ...base, p_steps: [step(1, 0), step(3, 3)] })).error?.message).toContain("STEPS_LOCKED");
  });

  it("two edits at the same moment are serialised: the result is exactly one of them, never a mix", async (ctx) => {
    if (!available) return ctx.skip();
    const seq = await newSequence("ed-par");
    const base = { p_tenant_id: tenantId, p_sequence_id: seq };
    const x = [step(1, 0, "X"), step(2, 2, "X"), step(3, 3, "X"), step(4, 4, "X")];
    const y = [step(1, 0, "Y"), step(2, 2, "Y"), step(3, 3, "Y"), step(4, 4, "Y"), step(5, 5, "Y")];

    const [r1, r2] = await Promise.all([db.rpc("apply_sequence_steps", { ...base, p_steps: x }), db.rpc("apply_sequence_steps", { ...base, p_steps: y })]);
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();

    const { data } = await db.from("email_sequence_steps").select("step_order, subject_template").eq("sequence_id", seq).order("step_order");
    const tags = new Set(data?.map((s) => s.subject_template.split("-")[1]));
    expect(tags.size).toBe(1); // all X or all Y
    expect(data?.length).toBe(tags.has("X") ? 4 : 5);
  });
});

describe("draft version check — a draft built from older steps is refused", () => {
  const draft = (enrollmentId: string, leadId: string, stepId: string, version: number | null) => ({
    tenant_id: tenantId, enrollment_id: enrollmentId, lead_id: leadId, step_id: stepId, step_order: 1, status: "pending", steps_version: version,
  });

  it("accepts the current version and an unstamped draft; refuses a stale one with STEPS_CHANGED", async (ctx) => {
    if (!available) return ctx.skip();
    const seq = await newSequence("dv-1");
    const lead = await newLead("dv1");
    const enr = await enroll(seq, lead);
    const { data: s1 } = await db.from("email_sequence_steps").select("id").eq("sequence_id", seq).eq("step_order", 1).single();
    const version = (await db.from("email_sequences").select("steps_version").eq("id", seq).single()).data!.steps_version as number;

    expect((await db.from("sequence_step_drafts").insert(draft(enr, lead, s1!.id, version))).error).toBeNull();
    expect((await db.from("sequence_step_drafts").insert(draft(enr, lead, s1!.id, null))).error).toBeNull(); // old callers

    await db.rpc("apply_sequence_steps", { p_tenant_id: tenantId, p_sequence_id: seq, p_steps: [step(1, 0, "edited"), step(2, 2), step(3, 3), step(4, 4)] });

    const stale = await db.from("sequence_step_drafts").insert(draft(enr, lead, s1!.id, version));
    expect(stale.error?.message).toContain("STEPS_CHANGED");
    expect((await db.from("sequence_step_drafts").insert(draft(enr, lead, s1!.id, version + 1))).error).toBeNull();
  });

  it("an edit and draft inserts at the same moment: every insert either lands or is refused as stale — no deadlock, no other error", async (ctx) => {
    if (!available) return ctx.skip();
    const seq = await newSequence("dv-race");
    const lead = await newLead("dv2");
    const enr = await enroll(seq, lead);
    const { data: s1 } = await db.from("email_sequence_steps").select("id").eq("sequence_id", seq).eq("step_order", 1).single();
    const version = (await db.from("email_sequences").select("steps_version").eq("id", seq).single()).data!.steps_version as number;

    for (let i = 0; i < 6; i++) {
      const results = await Promise.all([
        db.rpc("apply_sequence_steps", { p_tenant_id: tenantId, p_sequence_id: seq, p_steps: [step(1, 0, `r${i}`), step(2, 2), step(3, 3), step(4, 4)] }),
        ...Array.from({ length: 4 }, () => db.from("sequence_step_drafts").insert(draft(enr, lead, s1!.id, version))),
      ]);
      expect(results[0].error).toBeNull();
      for (const r of results.slice(1)) expect([null, "STEPS_CHANGED"]).toContain(r.error ? r.error.message : null);
    }
    // after the first edit, version `version` is stale for good: nothing stamped with it can be inserted any more
    expect((await db.from("sequence_step_drafts").insert(draft(enr, lead, s1!.id, version))).error?.message).toContain("STEPS_CHANGED");
  });
});
