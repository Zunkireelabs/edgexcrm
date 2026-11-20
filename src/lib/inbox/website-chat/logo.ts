// Rules for the chat logo an admin uploads. Pure functions (no network), so every rule is unit-tested.
//
// The file type is decided by what the bytes ARE (their first bytes), never by the name or the type the
// browser claims. SVG is refused on purpose: it can carry scripts.

export const MAX_LOGO_BYTES = 1024 * 1024; // 1 MB: a chat logo is tiny, and this keeps the upload quick

export type LogoType = "image/png" | "image/jpeg" | "image/webp";

const EXTENSIONS: Record<LogoType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Which image type these bytes are, or null when they are not a PNG, JPEG or WebP. */
export function sniffLogoType(bytes: Uint8Array): LogoType | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  // WebP: "RIFF", 4 size bytes, then "WEBP".
  if (
    bytes.length >= 12 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type LogoCheck = { ok: true; type: LogoType; name: string } | { ok: false; error: string };

/** Checks an uploaded logo and picks a safe file name for it (the uploaded name is never used). */
export function checkLogoFile(bytes: Uint8Array): LogoCheck {
  if (bytes.length === 0) return { ok: false, error: "That file is empty. Pick a PNG, JPG or WebP image." };
  if (bytes.length > MAX_LOGO_BYTES) {
    return { ok: false, error: `That image is too big (${(bytes.length / 1024 / 1024).toFixed(1)} MB). Use one under 1 MB.` };
  }
  const type = sniffLogoType(bytes);
  if (!type) return { ok: false, error: "Use a PNG, JPG or WebP image. Other types, including SVG, are not allowed." };
  return { ok: true, type, name: `chat-logo.${EXTENSIONS[type]}` };
}
