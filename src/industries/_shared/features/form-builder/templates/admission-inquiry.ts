import type { TemplateDefinition } from "../types";

export const admissionInquiryTemplate: TemplateDefinition = {
  id: "admission-inquiry",
  name: "Admission Inquiry",
  description: "Capture study preferences and contact details from prospective students.",
  icon: "BookOpen",
  isMultiStep: true,
  branding: {
    title: "Admission Inquiry",
    subtitle: "Tell us about your study goals and we'll guide you",
    button_text: "Submit Inquiry",
    thank_you_title: "Inquiry Received!",
    thank_you_message: "Our counselors will contact you within 24 hours.",
  },
  steps: [
    {
      title: "Contact Information",
      fields: [
        { name: "first_name", label: "First Name", type: "text", required: true, width: "half" },
        { name: "last_name", label: "Last Name", type: "text", required: true, width: "half" },
        { name: "email", label: "Email Address", type: "email", required: true, width: "half" },
        { name: "phone", label: "Phone Number", type: "tel", required: true, width: "half" },
        {
          name: "country",
          label: "Country of Residence",
          type: "select",
          required: true,
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
      title: "Study Preferences",
      fields: [
        {
          name: "preferred_destination",
          label: "Preferred Study Destination",
          type: "select",
          required: true,
          width: "half",
          options: [
            { label: "Australia", value: "australia" },
            { label: "Canada", value: "canada" },
            { label: "United Kingdom", value: "uk" },
            { label: "United States", value: "usa" },
            { label: "New Zealand", value: "new_zealand" },
            { label: "Europe", value: "europe" },
          ],
        },
        { name: "preferred_course", label: "Preferred Course", type: "entity_select", required: true, width: "half" },
        {
          name: "preferred_intake",
          label: "Preferred Intake",
          type: "select",
          required: false,
          width: "half",
          options: [
            { label: "January 2025", value: "jan_2025" },
            { label: "May 2025", value: "may_2025" },
            { label: "September 2025", value: "sep_2025" },
            { label: "January 2026", value: "jan_2026" },
          ],
        },
        {
          name: "study_level",
          label: "Interested Degree Level",
          type: "select",
          required: true,
          width: "half",
          options: [
            { label: "Diploma", value: "diploma" },
            { label: "Bachelor's", value: "bachelors" },
            { label: "Master's", value: "masters" },
            { label: "PhD", value: "phd" },
          ],
        },
        {
          name: "budget_range",
          label: "Annual Budget (USD)",
          type: "select",
          required: false,
          options: [
            { label: "Under $10,000", value: "under_10k" },
            { label: "$10,000 - $20,000", value: "10k_20k" },
            { label: "$20,000 - $30,000", value: "20k_30k" },
            { label: "Above $30,000", value: "above_30k" },
          ],
        },
      ],
    },
    {
      title: "Additional Information",
      fields: [
        { name: "message", label: "Additional Message", type: "textarea", required: false, placeholder: "Any specific questions or requirements?" },
        {
          name: "how_did_you_hear",
          label: "How did you hear about us?",
          type: "select",
          required: false,
          options: [
            { label: "Social Media", value: "social_media" },
            { label: "Friend / Family", value: "referral" },
            { label: "Google Search", value: "google" },
            { label: "Education Fair", value: "education_fair" },
            { label: "Other", value: "other" },
          ],
        },
      ],
    },
  ],
};
