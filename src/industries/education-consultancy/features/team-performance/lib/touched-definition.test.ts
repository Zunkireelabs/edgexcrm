import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Locks the canonical "touched" definition (see migration 241's header comment):
//   lead_activities(activity_type IN ('call','email','meeting')) UNION lead_notes
// sms_messages / email_messages (no user_id — unattributable, and blast/sequence
// sends are automated, not human contact) and lead_assignment_history (a handoff
// record, not contact with the lead) must NEVER be unioned in. This can't be
// exercised against a live DB (no DB access in this environment/session — see
// CLAUDE.md's "Do Not Touch The Database"), so this test statically asserts the
// RPC source never references the forbidden tables in a touch-computation CTE,
// and does reference the two required ones. A future editor who adds
// sms_messages/email_messages/lead_assignment_history into education_relay_
// aggregates, education_intake_alarm, or education_idle_staff will fail this.

const MIGRATIONS_DIR = join(__dirname, "../../../../../../supabase/migrations");

function readMigration(filename: string): string {
  return readFileSync(join(MIGRATIONS_DIR, filename), "utf-8");
}

// Only the executable SQL bodies matter — the header comments above deliberately
// name the forbidden tables to document why they're excluded, which would
// otherwise false-positive a naive full-file substring check.
function functionBodies(sql: string): string {
  const matches = sql.matchAll(/AS \$\$([\s\S]*?)\$\$;/g);
  return Array.from(matches, (m) => m[1]).join("\n");
}

const FORBIDDEN_TABLES = ["sms_messages", "email_messages", "lead_assignment_history"];
const REQUIRED_TABLES = ["lead_activities", "lead_notes"];

describe("canonical 'touched' definition — migration 241 (education_relay_aggregates)", () => {
  const body = functionBodies(readMigration("241_education_relay_aggregates.sql"));

  it("never unions a forbidden non-attributable/non-contact table", () => {
    for (const table of FORBIDDEN_TABLES) {
      expect(body).not.toContain(table);
    }
  });

  it("unions both required attributable touch sources", () => {
    for (const table of REQUIRED_TABLES) {
      expect(body).toContain(table);
    }
  });

  it("restricts lead_activities to call/email/meeting only", () => {
    expect(body).toMatch(/activity_type IN \('call', 'email', 'meeting'\)/);
  });
});

describe("canonical 'touched' definition — migration 242 (education_intake_alarm + education_idle_staff)", () => {
  const body = functionBodies(readMigration("242_education_intake_and_idle.sql"));

  it("never references a forbidden non-attributable/non-contact table", () => {
    for (const table of FORBIDDEN_TABLES) {
      expect(body).not.toContain(table);
    }
  });

  it("references both required attributable touch sources", () => {
    for (const table of REQUIRED_TABLES) {
      expect(body).toContain(table);
    }
  });

  it("restricts lead_activities to call/email/meeting only", () => {
    expect(body).toMatch(/activity_type IN \('call', 'email', 'meeting'\)/);
  });
});
