import type { TemplateDefinition } from "../types";

export const scholarshipApplicationTemplate: TemplateDefinition = {
  id: "scholarship-application",
  name: "Scholarship Application",
  description: "Collect student details, academic background, and supporting documents for scholarship applications.",
  icon: "GraduationCap",
  isMultiStep: true,
  branding: {
    title: "Scholarship Application",
    subtitle: "Fill in your details to apply for a scholarship",
    button_text: "Submit Application",
    thank_you_title: "Application Submitted!",
    thank_you_message: "Thank you for applying. We will review your application and get back to you shortly.",
  },
  steps: [
    {
      title: "Personal Information",
      fields: [
        { name: "first_name", label: "First Name", type: "text", required: true, width: "half" },
        { name: "last_name", label: "Last Name", type: "text", required: true, width: "half" },
        { name: "email", label: "Email Address", type: "email", required: true, width: "half" },
        { name: "phone", label: "Phone Number", type: "tel", required: true, width: "half" },
        { name: "date_of_birth", label: "Date of Birth", type: "date", required: true, width: "half" },
        {
          name: "country",
          label: "Country",
          type: "select",
          required: true,
          width: "half",
          options: [
            { label: "Nepal", value: "nepal" },
            { label: "India", value: "india" },
            { label: "Bangladesh", value: "bangladesh" },
            { label: "Sri Lanka", value: "sri_lanka" },
            { label: "Pakistan", value: "pakistan" },
            { label: "Other", value: "other" },
          ],
        },
      ],
    },
    {
      title: "Academic Details",
      fields: [
        {
          name: "highest_qualification",
          label: "Highest Qualification",
          type: "select",
          required: true,
          options: [
            { label: "High School (10th)", value: "high_school" },
            { label: "Intermediate (12th)", value: "intermediate" },
            { label: "Bachelor's Degree", value: "bachelors" },
            { label: "Master's Degree", value: "masters" },
          ],
        },
        { name: "gpa", label: "GPA / Percentage", type: "number", required: true, width: "half", validation: { min: 0, max: 100 } },
        { name: "preferred_course", label: "Preferred Course", type: "entity_select", required: true, width: "half" },
        {
          name: "preferred_intake",
          label: "Preferred Intake",
          type: "select",
          required: true,
          width: "half",
          options: [
            { label: "January 2025", value: "jan_2025" },
            { label: "May 2025", value: "may_2025" },
            { label: "September 2025", value: "sep_2025" },
            { label: "January 2026", value: "jan_2026" },
          ],
        },
      ],
    },
    {
      title: "Documents & Agreement",
      fields: [
        { name: "statement_of_purpose", label: "Statement of Purpose", type: "textarea", required: true, placeholder: "Tell us why you deserve this scholarship..." },
        { name: "resume", label: "Resume / CV", type: "file", required: true, validation: { max_size_mb: 5, accepted_types: ["application/pdf"] } },
        { name: "academic_transcript", label: "Academic Transcript", type: "file", required: true, validation: { max_size_mb: 5, accepted_types: ["application/pdf", "image/jpeg", "image/png"] } },
        { name: "terms_agreement", label: "I agree to the terms and conditions", type: "checkbox", required: true },
      ],
    },
  ],
};
