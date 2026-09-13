// Field validators specific to the applicant-documents API routes, in the
// same (value) => string | null shape src/lib/api/validation.ts's validate() expects.

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

export function isSha256Checksum(): (value: unknown) => string | null {
  return (value) => {
    if (!value || typeof value !== "string") return null;
    if (!SHA256_HEX_RE.test(value)) return "Must be a 64-character sha256 hex digest";
    return null;
  };
}
