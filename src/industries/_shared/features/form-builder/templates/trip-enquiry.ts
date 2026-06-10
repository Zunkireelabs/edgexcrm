import type { TemplateDefinition } from "../types";
import { TRIP_TYPES } from "@/industries/travel-agency/leads/trip-types";

export const tripEnquiryTemplate: TemplateDefinition = {
  id: "trip-enquiry",
  name: "Trip Enquiry",
  description: "Capture traveller details, destination, dates, and trip type from your website.",
  icon: "Plane",
  isMultiStep: true,
  branding: {
    title: "Plan Your Trip",
    subtitle: "Tell us where you want to go and we'll craft your perfect itinerary",
    button_text: "Get My Quote",
    thank_you_title: "Enquiry Received!",
    thank_you_message: "We'll send your custom quote shortly.",
  },
  steps: [
    {
      title: "Contact",
      fields: [
        { name: "first_name", label: "First Name", type: "text", required: true, width: "half" },
        { name: "last_name", label: "Last Name", type: "text", required: true, width: "half" },
        { name: "email", label: "Email Address", type: "email", required: true, width: "half" },
        { name: "phone", label: "Phone Number", type: "tel", required: true, width: "half" },
      ],
    },
    {
      title: "Your Trip",
      fields: [
        {
          name: "package",
          label: "Package of Interest",
          type: "entity_select",
          required: false,
        },
        {
          name: "trip_destination",
          label: "Destination",
          type: "text",
          required: false,
          placeholder: "e.g. Bali, Indonesia",
          width: "half",
        },
        {
          name: "trip_departure_city",
          label: "Departure City",
          type: "text",
          required: false,
          placeholder: "e.g. Kathmandu",
          width: "half",
        },
        {
          name: "trip_start_date",
          label: "Travel Start Date",
          type: "date",
          required: false,
          width: "half",
        },
        {
          name: "trip_end_date",
          label: "Travel End Date",
          type: "date",
          required: false,
          width: "half",
        },
        {
          name: "trip_pax_adults",
          label: "Adults",
          type: "number",
          required: false,
          width: "half",
        },
        {
          name: "trip_pax_children",
          label: "Children",
          type: "number",
          required: false,
          width: "half",
        },
        {
          name: "trip_type",
          label: "Trip Type",
          type: "select",
          required: false,
          options: TRIP_TYPES.map((t) => ({ label: t.label, value: t.value })),
        },
        {
          name: "trip_budget_amount",
          label: "Budget (NPR)",
          type: "number",
          required: false,
        },
        {
          name: "message",
          label: "Additional Notes",
          type: "textarea",
          required: false,
          placeholder: "Any special requirements, preferences, or questions?",
        },
      ],
    },
  ],
};
