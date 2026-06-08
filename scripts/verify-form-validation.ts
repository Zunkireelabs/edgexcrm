/**
 * Throwaway verification harness for validateSubmissionAgainstForm().
 * Pure in-memory — touches NO real DB.
 * Run: npx tsx scripts/verify-form-validation.ts
 */
import { validateSubmissionAgainstForm } from "../src/lib/leads/form-validation";
import type { FormStep } from "../src/types/database";

// ── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed++;
  } else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

function valid(steps: FormStep[], values: Record<string, unknown>) {
  return validateSubmissionAgainstForm(steps, values).valid;
}

function hasError(steps: FormStep[], values: Record<string, unknown>, field: string) {
  const r = validateSubmissionAgainstForm(steps, values);
  return !r.valid && Object.prototype.hasOwnProperty.call(r.errors, field);
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const textRequired: FormStep[] = [
  { title: "Step 1", fields: [{ name: "full_name", label: "Name", type: "text", required: true }] },
];

const emailField: FormStep[] = [
  { title: "Step 1", fields: [{ name: "email", label: "Email", type: "email", required: true }] },
];

const numberField: FormStep[] = [
  {
    title: "Step 1",
    fields: [
      {
        name: "age", label: "Age", type: "number", required: false,
        validation: { min: 18, max: 65 },
      },
    ],
  },
];

const dateField: FormStep[] = [
  {
    title: "Step 1",
    fields: [
      {
        name: "dob", label: "DOB", type: "date", required: false,
        validation: { min_date: "2000-01-01", max_date: "2010-12-31" },
      },
    ],
  },
];

const selectField: FormStep[] = [
  {
    title: "Step 1",
    fields: [
      {
        name: "country", label: "Country", type: "select", required: true,
        options: [{ label: "Nepal", value: "NP" }, { label: "India", value: "IN" }],
      },
    ],
  },
];

const radioField: FormStep[] = [
  {
    title: "Step 1",
    fields: [
      {
        name: "gender", label: "Gender", type: "radio", required: false,
        options: [{ label: "Male", value: "male" }, { label: "Female", value: "female" }],
      },
    ],
  },
];

const checkboxField: FormStep[] = [
  {
    title: "Step 1",
    fields: [
      {
        name: "interests", label: "Interests", type: "checkbox", required: false,
        options: [
          { label: "Sports", value: "sports" },
          { label: "Music", value: "music" },
          { label: "Art", value: "art" },
        ],
      },
    ],
  },
];

const fileField: FormStep[] = [
  { title: "Step 1", fields: [{ name: "cv", label: "CV", type: "file", required: true }] },
];

const entitySelectField: FormStep[] = [
  { title: "Step 1", fields: [{ name: "university", label: "University", type: "entity_select", required: true }] },
];

const patternField: FormStep[] = [
  {
    title: "Step 1",
    fields: [
      {
        name: "code", label: "Code", type: "text", required: false,
        validation: { pattern: "^[A-Z]{3}$" },
      },
    ],
  },
];

const malformedPatternField: FormStep[] = [
  {
    title: "Step 1",
    fields: [
      {
        name: "code", label: "Code", type: "text", required: false,
        // invalid regex
        validation: { pattern: "[invalid(((" },
      },
    ],
  },
];

const conditionalStep: FormStep[] = [
  {
    title: "Step 1",
    fields: [
      {
        name: "has_visa", label: "Has Visa?", type: "select", required: true,
        options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
      },
      {
        name: "visa_number", label: "Visa Number", type: "text", required: true,
        conditional: { field: "has_visa", values: ["yes"] },
      },
    ],
  },
];

// ── Prime Ceramics fixture ──────────────────────────────────────────────────
// Simulates the "request-a-quote" form schema for Prime Ceramics.
const primeCeramicsSchema: FormStep[] = [
  {
    title: "Request a Quote",
    fields: [
      { name: "your_name",    label: "Your Name",    type: "text",   required: true },
      { name: "email",        label: "Email",        type: "email",  required: true },
      { name: "phone_number", label: "Phone Number", type: "tel",    required: true },
      {
        name: "tile_size", label: "Tile Size", type: "select", required: true,
        options: [
          { label: "300×300 mm",  value: "300×300 mm" },
          { label: "600×600 mm",  value: "600×600 mm" },
          { label: "1200×1200 mm", value: "1200×1200 mm" },
        ],
      },
      {
        name: "project_type", label: "Project Type", type: "select", required: true,
        options: [
          { label: "Residential", value: "Residential" },
          { label: "Commercial",  value: "Commercial" },
        ],
      },
      { name: "message", label: "Message", type: "textarea", required: false },
    ],
  },
];

// Prime Ceramics Mode-B payload (field names differ from schema, option values differ)
const primeCeramicsBody = {
  first_name: "Raj",
  email: "raj@primeceramics.com",
  phone: "+91-9876543210",
  custom_fields: {
    source: "website",
    message: "Looking for floor tiles for my new house",
    tile_size: "600×1200 mm",   // NOT in declared options
    project_type: "Home",        // NOT in declared options
  },
};

// Assemble values exactly as both Mode A and Mode B do
const primeCeramicsValues = {
  ...(primeCeramicsBody.custom_fields as Record<string, unknown>),
  first_name: primeCeramicsBody.first_name,
  last_name: undefined,
  email: primeCeramicsBody.email,
  phone: primeCeramicsBody.phone,
  city: undefined,
  country: undefined,
};

// ── Tests ──────────────────────────────────────────────────────────────────

console.log("\n── Required field ──");
check("required field present → valid",          valid(textRequired, { full_name: "Alice" }));
check("required field missing → error",          hasError(textRequired, {}, "full_name"));
check("required field empty string → error",     hasError(textRequired, { full_name: "   " }, "full_name"));
check("required field empty array → error",      hasError(textRequired, { full_name: [] }, "full_name"));

console.log("\n── Conditional visibility ──");
check("conditional field hidden → no error when controller doesn't match",
  valid(conditionalStep, { has_visa: "no", visa_number: "" }));
check("conditional field visible → required enforced when controller matches",
  hasError(conditionalStep, { has_visa: "yes", visa_number: "" }, "visa_number"));
check("conditional field visible + filled → valid",
  valid(conditionalStep, { has_visa: "yes", visa_number: "V1234567" }));

console.log("\n── Email ──");
check("valid email → valid",                     valid(emailField, { email: "user@example.com" }));
check("invalid email → error",                   hasError(emailField, { email: "not-an-email" }, "email"));
check("email with no domain → error",            hasError(emailField, { email: "user@" }, "email"));

console.log("\n── Number ──");
check("valid number → valid",                    valid(numberField, { age: 30 }));
check("non-finite → error",                      hasError(numberField, { age: "abc" }, "age"));
check("below min → error",                       hasError(numberField, { age: 10 }, "age"));
check("above max → error",                       hasError(numberField, { age: 100 }, "age"));
check("at min boundary → valid",                 valid(numberField, { age: 18 }));
check("at max boundary → valid",                 valid(numberField, { age: 65 }));
check("number as string → valid",                valid(numberField, { age: "25" }));

console.log("\n── Date ──");
check("valid date → valid",                      valid(dateField, { dob: "2005-06-15" }));
check("invalid date string → error",             hasError(dateField, { dob: "not-a-date" }, "dob"));
check("before min_date → error",                 hasError(dateField, { dob: "1999-12-31" }, "dob"));
check("after max_date → error",                  hasError(dateField, { dob: "2011-01-01" }, "dob"));
check("at min_date boundary → valid",            valid(dateField, { dob: "2000-01-01" }));
check("at max_date boundary → valid",            valid(dateField, { dob: "2010-12-31" }));

console.log("\n── Select / Radio option membership ──");
check("select valid option → valid",             valid(selectField, { country: "NP" }));
check("select invalid option → error",           hasError(selectField, { country: "XX" }, "country"));
check("radio valid option → valid",              valid(radioField, { gender: "male" }));
check("radio invalid option → error",            hasError(radioField, { gender: "other" }, "gender"));
check("select required missing → error",         hasError(selectField, {}, "country"));

console.log("\n── Checkbox multi membership ──");
check("checkbox valid multi → valid",
  valid(checkboxField, { interests: ["sports", "music"] }));
check("checkbox one invalid → error",
  hasError(checkboxField, { interests: ["sports", "unknown"] }, "interests"));
check("checkbox no options declared → skip membership",
  valid(
    [{ title: "S", fields: [{ name: "agree", label: "Agree", type: "checkbox", required: false }] }],
    { agree: "anything" }
  ));

console.log("\n── Skipped types (file + entity_select) ──");
check("file required+empty → NO error (skipped)",     !hasError(fileField, {}, "cv"));
check("entity_select required+empty → NO error",      !hasError(entitySelectField, {}, "university"));

console.log("\n── Pattern ──");
check("pattern pass → valid",                    valid(patternField, { code: "ABC" }));
check("pattern fail → error",                    hasError(patternField, { code: "abc" }, "code"));
check("malformed pattern → does NOT throw",      (() => {
  try {
    // Should return a result (pass or fail doesn't matter — must not throw)
    validateSubmissionAgainstForm(malformedPatternField, { code: "ABC" });
    return true;
  } catch {
    return false;
  }
})());

console.log("\n── Null / empty steps guard ──");
check("null steps → valid:true",    validateSubmissionAgainstForm(null, { email: "x@y.com" }).valid);
check("undefined steps → valid:true", validateSubmissionAgainstForm(undefined, {}).valid);
check("empty steps array → valid:true", validateSubmissionAgainstForm([], { foo: "bar" }).valid);

console.log("\n── Prime Ceramics Mode-B simulation ──");
const pcResult = validateSubmissionAgainstForm(primeCeramicsSchema, primeCeramicsValues);
check("Prime Ceramics payload → INVALID (proves Mode B must be log-only)", !pcResult.valid);
check("  your_name missing → error", Object.prototype.hasOwnProperty.call(pcResult.errors, "your_name"));
check("  phone_number missing → error", Object.prototype.hasOwnProperty.call(pcResult.errors, "phone_number"));
check("  tile_size invalid option → error", Object.prototype.hasOwnProperty.call(pcResult.errors, "tile_size"));
check("  project_type invalid option → error", Object.prototype.hasOwnProperty.call(pcResult.errors, "project_type"));
check("  email present → no email error", !Object.prototype.hasOwnProperty.call(pcResult.errors, "email"));

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("\nAll tests passed.");
