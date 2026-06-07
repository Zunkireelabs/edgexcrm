import type { TemplateDefinition } from "../types";

export const counselingBookingTemplate: TemplateDefinition = {
  id: "counseling-booking",
  name: "Counseling Booking",
  description: "Let students book a counseling session with preferred date, time, and topic.",
  icon: "CalendarClock",
  isMultiStep: false,
  branding: {
    title: "Book a Counseling Session",
    subtitle: "Our expert counselors are ready to guide you",
    button_text: "Book Session",
    thank_you_title: "Session Booked!",
    thank_you_message: "Your counseling session has been booked. We'll confirm your appointment shortly.",
  },
  steps: [
    {
      title: "Book a Counseling Session",
      fields: [
        { name: "first_name", label: "First Name", type: "text", required: true, width: "half" },
        { name: "last_name", label: "Last Name", type: "text", required: true, width: "half" },
        { name: "email", label: "Email Address", type: "email", required: true, width: "half" },
        { name: "phone", label: "Phone Number", type: "tel", required: true, width: "half" },
        { name: "preferred_date", label: "Preferred Date", type: "date", required: true, width: "half" },
        {
          name: "preferred_time",
          label: "Preferred Time",
          type: "select",
          required: true,
          width: "half",
          options: [
            { label: "9:00 AM", value: "09:00" },
            { label: "10:00 AM", value: "10:00" },
            { label: "11:00 AM", value: "11:00" },
            { label: "1:00 PM", value: "13:00" },
            { label: "2:00 PM", value: "14:00" },
            { label: "3:00 PM", value: "15:00" },
            { label: "4:00 PM", value: "16:00" },
          ],
        },
        {
          name: "counseling_topic",
          label: "Counseling Topic",
          type: "select",
          required: true,
          options: [
            { label: "Study Abroad Planning", value: "study_abroad" },
            { label: "Course Selection", value: "course_selection" },
            { label: "Visa Guidance", value: "visa" },
            { label: "Scholarship Opportunities", value: "scholarship" },
            { label: "Application Review", value: "application_review" },
            { label: "General Inquiry", value: "general" },
          ],
        },
        { name: "notes", label: "Additional Notes", type: "textarea", required: false, placeholder: "Any specific topics or questions you'd like to discuss?" },
      ],
    },
  ],
};
