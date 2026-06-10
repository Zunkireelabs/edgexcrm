export function isValidEmail(email: string): boolean {
  if (!email) return true;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidPhone(phone: string): boolean {
  if (!phone) return true;
  const local = phone.replace(/^\+\d{1,4}[-\s]?/, "");
  return local.replace(/\D/g, "").length >= 7;
}

export interface LeadIdentityErrors {
  general?: string;
  email?: string;
  phone?: string;
}

export function validateLeadIdentity(fields: {
  email?: string;
  firstName?: string;
  phone?: string;
}): LeadIdentityErrors {
  const errors: LeadIdentityErrors = {};

  if (!fields.email && !fields.firstName) {
    errors.general = "Please provide at least an email or first name";
  }
  if (fields.email && !isValidEmail(fields.email)) {
    errors.email = "Please enter a valid email address";
  }
  if (fields.phone && !isValidPhone(fields.phone)) {
    errors.phone = "Please enter a valid phone number";
  }

  return errors;
}
