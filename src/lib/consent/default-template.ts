/**
 * A professional, ready-to-use default consent document for education
 * consultancies. Admins can load it into the editor as a starting point and
 * tweak it. Merge fields ({{...}}) auto-fill per student when the link is sent.
 */
export const DEFAULT_CONSENT_TEMPLATE = `This Student Consent & Authorization ("Agreement") is entered into on {{date}} between {{organization}} ("the Consultancy") and the student named below.

STUDENT DETAILS
  Name:    {{student_name}}
  Email:   {{student_email}}
  Phone:   {{student_phone}}
  Address: {{city}}, {{country}}

1. PURPOSE
   I authorize the Consultancy to act as my education consultant and to guide me through the university application and admission process.

2. USE OF PERSONAL INFORMATION
   I consent to the Consultancy collecting, storing, and processing my personal information for the purpose of preparing and submitting applications to universities and related institutions on my behalf.

3. DATA SHARING
   I understand my information may be shared with universities, partner institutions, and relevant third parties solely for the purpose of my applications.

4. ACCURACY OF INFORMATION
   I confirm that the information I have provided is true and accurate to the best of my knowledge.

5. CONSENT
   I have read and understood this document and agree to its terms by signing below.

Consent version: {{consent_version}}
Date: {{date}}`;
