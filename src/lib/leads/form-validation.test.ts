import { describe, it, expect } from "vitest";
import { validateSubmissionAgainstForm, buildSchemaValidationValues } from "./form-validation";
import type { FormStep } from "@/types/database";

describe("buildSchemaValidationValues", () => {
  it("includes destinations and field_of_study as top-level values — the exact regression", () => {
    // Real production shape: a widget submission with destinations/field_of_study
    // sent as top-level body fields (not nested in custom_fields), matching how
    // public-form.tsx actually builds the request.
    const body = {
      first_name: "Luffy",
      last_name: "Test",
      email: "luffy@example.com",
      phone: "9898478594",
      city: null,
      country: null,
      destinations: "Canada",
      field_of_study: "Applied Sciences",
      custom_fields: { country_field: "india", degree_level: "Post Graduate" },
    };
    const values = buildSchemaValidationValues(body);
    expect(values.destinations).toBe("Canada");
    expect(values.field_of_study).toBe("Applied Sciences");
    // custom_fields values still come through unchanged
    expect(values.degree_level).toBe("Post Graduate");
  });

  it("a required destinations/field_of_study field now validates successfully against a real submission", () => {
    const steps: FormStep[] = [
      {
        title: "Step 1",
        fields: [
          {
            name: "destinations",
            type: "select",
            label: "Study Destination",
            required: true,
            options: [{ label: "Canada", value: "Canada" }],
          },
          {
            name: "field_of_study",
            type: "select",
            label: "Field of Study",
            required: true,
            options: [{ label: "Applied Sciences", value: "Applied Sciences" }],
          },
        ],
      },
    ];
    const body = { destinations: "Canada", field_of_study: "Applied Sciences", custom_fields: {} };
    const result = validateSubmissionAgainstForm(steps, buildSchemaValidationValues(body));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("still correctly reports missing when destinations/field_of_study are genuinely absent", () => {
    const steps: FormStep[] = [
      {
        title: "Step 1",
        fields: [
          { name: "destinations", type: "select", label: "Study Destination", required: true, options: [] },
          { name: "field_of_study", type: "select", label: "Field of Study", required: true, options: [] },
        ],
      },
    ];
    const body = { custom_fields: {} };
    const result = validateSubmissionAgainstForm(steps, buildSchemaValidationValues(body));
    expect(result.valid).toBe(false);
    expect(result.errors.destinations).toEqual(["This field is required"]);
    expect(result.errors.field_of_study).toEqual(["This field is required"]);
  });
});
