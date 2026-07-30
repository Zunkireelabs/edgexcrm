/**
 * Strip anything that could break or inject into an RFC 5322 header, then bound the length.
 * CR/LF are the header-injection vector; angle brackets would corrupt the name-addr form.
 */
export function sanitizeHeaderName(name: string): string {
  return name.replace(/[\r\n<>]/g, "").trim().slice(0, 120);
}
