import type { TemplateDefinition } from "../types";
import { scholarshipApplicationTemplate } from "./scholarship-application";
import { admissionInquiryTemplate } from "./admission-inquiry";
import { counselingBookingTemplate } from "./counseling-booking";
import { generalContactTemplate } from "./general-contact";

export const EDUCATION_CONSULTANCY_TEMPLATES: TemplateDefinition[] = [
  scholarshipApplicationTemplate,
  admissionInquiryTemplate,
  counselingBookingTemplate,
  generalContactTemplate,
];

export const BLANK_TEMPLATE: TemplateDefinition = {
  id: "blank",
  name: "Blank Form",
  description: "Start from scratch and build your own custom form.",
  icon: "Plus",
  isMultiStep: false,
  branding: {
    title: "New Form",
    primary_color: "#6366f1",
    button_text: "Submit",
    thank_you_title: "Thank you!",
    thank_you_message: "Your response has been submitted.",
  },
  steps: [
    {
      title: "Step 1",
      fields: [],
    },
  ],
};

export function getTemplateById(id: string): TemplateDefinition | undefined {
  if (id === "blank") return BLANK_TEMPLATE;
  return EDUCATION_CONSULTANCY_TEMPLATES.find((t) => t.id === id);
}

export {
  scholarshipApplicationTemplate,
  admissionInquiryTemplate,
  counselingBookingTemplate,
  generalContactTemplate,
};
