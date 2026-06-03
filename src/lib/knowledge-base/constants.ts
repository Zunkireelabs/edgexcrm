export const KB_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

export const KB_ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // PPTX
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
