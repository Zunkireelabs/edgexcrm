import type { TemplateDefinition } from "../types";

export const generalContactTemplate: TemplateDefinition = {
  id: "general-contact",
  name: "General Contact Form",
  description: "A simple contact form for general inquiries.",
  icon: "MessageSquare",
  isMultiStep: false,
  branding: {
    title: "Contact Us",
    subtitle: "We'd love to hear from you",
    button_text: "Send Message",
    thank_you_title: "Message Sent!",
    thank_you_message: "Thank you for reaching out. We'll get back to you within 24 hours.",
  },
  steps: [
    {
      title: "Contact Us",
      fields: [
        { name: "first_name", label: "First Name", type: "text", required: true, width: "half" },
        { name: "last_name", label: "Last Name", type: "text", required: true, width: "half" },
        { name: "email", label: "Email Address", type: "email", required: true, width: "half" },
        { name: "phone", label: "Phone Number", type: "tel", required: false, width: "half" },
        { name: "subject", label: "Subject", type: "text", required: true, placeholder: "What is your inquiry about?" },
        { name: "message", label: "Message", type: "textarea", required: true, placeholder: "Tell us how we can help you..." },
      ],
    },
  ],
};
