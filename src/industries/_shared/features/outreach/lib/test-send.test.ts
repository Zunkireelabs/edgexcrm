import { describe, it, expect } from "vitest";
import { buildTestEmail, sampleLead, validateTestInput, TEST_MAX_BODY, TEST_MAX_SUBJECT, TEST_SUBJECT_PREFIX } from "./test-send";

// "Send me a test": the step as a lead would get it, with SAMPLE data, clearly marked as a test.

describe("buildTestEmail", () => {
  const base = { tenantName: "Admizz Education", toEmail: "rep@admizz.org" };

  it("fills merge tags with the same sample lead the preview uses, and marks the subject [Test]", () => {
    const mail = buildTestEmail({ ...base, subject: "Quick question, {{first_name}}?", body: "<p>Hi {{first_name}} {{last_name}} from {{city}} — {{tenant_name}}</p>" });
    expect(mail.subject).toBe(`${TEST_SUBJECT_PREFIX}Quick question, Jane?`);
    expect(mail.body_html).toContain("<p>Hi Jane Doe from Sydney — Admizz Education</p>");
  });

  it("uses a tag's fallback only when the sample has no value for it", () => {
    const mail = buildTestEmail({ ...base, subject: "{{first_name|there}} / {{nickname|friend}}", body: "<p>x</p>" });
    expect(mail.subject).toBe("[Test] Jane / friend");
  });

  it("puts a visible note above the body saying it is a test with sample data (and names the step, escaped)", () => {
    const mail = buildTestEmail({ ...base, subject: "s", body: "<p>x</p>", stepLabel: 'Step 2 of "Welcome" <b>' });
    expect(mail.body_html.startsWith("<p style=")).toBe(true);
    expect(mail.body_html).toContain("This is a test of Step 2 of &quot;Welcome&quot; &lt;b&gt;");
    expect(mail.body_html).toContain("sample data");
    expect(mail.body_html.endsWith("<p>x</p>")).toBe(true);
  });

  it("the sample lead carries the recipient's address", () => {
    expect(sampleLead("rep@admizz.org").email).toBe("rep@admizz.org");
  });
});

describe("validateTestInput", () => {
  it("accepts a subject and a body", () => {
    expect(validateTestInput("Hi", "<p>x</p>")).toEqual({ ok: true, subject: "Hi", body: "<p>x</p>" });
  });

  it("asks for a subject and a body, in plain words", () => {
    const r = validateTestInput("  ", "");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toEqual({ subject_template: ["Add a subject first."], body_template: ["Add some text to the email first."] });
    expect(validateTestInput(undefined, 5).ok).toBe(false);
  });

  it("refuses an over-long subject or a huge body", () => {
    expect(validateTestInput("x".repeat(TEST_MAX_SUBJECT + 1), "b").ok).toBe(false);
    expect(validateTestInput("s", "x".repeat(TEST_MAX_BODY + 1)).ok).toBe(false);
    expect(validateTestInput("x".repeat(TEST_MAX_SUBJECT), "x".repeat(TEST_MAX_BODY)).ok).toBe(true);
  });
});
