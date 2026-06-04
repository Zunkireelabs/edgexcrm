import type { gmail_v1 } from "googleapis";

export interface ParsedMessage {
  gmail_message_id: string;
  gmail_thread_id: string;
  rfc_message_id: string | null;
  in_reply_to: string | null;
  references: string[];
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  body_html: string;
  body_text: string;
  received_at: string; // ISO timestamp
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// Parse RFC822 address: "Display Name" <addr@host> or addr@host
function parseAddress(raw: string): { email: string; name: string | null } {
  const match = raw.match(/^"?([^"<>]+?)"?\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim() || null, email: match[2].trim() };
  }
  return { name: null, email: raw.trim() };
}

function parseAddressList(raw: string): string[] {
  if (!raw) return [];
  // Split by comma, but only at top-level (not inside quotes/angle brackets)
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of raw) {
    if (ch === "<") depth++;
    else if (ch === ">") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.map((p) => parseAddress(p).email).filter(Boolean);
}

function parseReferences(raw: string): string[] {
  if (!raw) return [];
  // References header is space/newline-separated list of <id@host> tokens
  return (raw.match(/<[^>]+>/g) ?? []).filter(Boolean);
}

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function extractBody(
  part: gmail_v1.Schema$MessagePart,
): { html: string; text: string } {
  let html = "";
  let text = "";

  function walk(p: gmail_v1.Schema$MessagePart) {
    const mime = p.mimeType ?? "";
    if (mime === "text/html" && p.body?.data && !html) {
      html = decodeBase64Url(p.body.data);
    } else if (mime === "text/plain" && p.body?.data && !text) {
      text = decodeBase64Url(p.body.data);
    }
    for (const child of p.parts ?? []) {
      walk(child);
    }
  }

  walk(part);
  return { html, text };
}

export function parseGmailMessage(data: gmail_v1.Schema$Message): ParsedMessage {
  const headers = data.payload?.headers ?? [];
  const fromRaw = getHeader(headers, "From");
  const { email: from_email, name: from_name } = parseAddress(fromRaw);

  const receivedRaw = getHeader(headers, "Date");
  let received_at: string;
  try {
    received_at = new Date(receivedRaw).toISOString();
  } catch {
    received_at = new Date().toISOString();
  }

  const { html: body_html, text: body_text } = extractBody(data.payload ?? {});

  return {
    gmail_message_id: data.id ?? "",
    gmail_thread_id: data.threadId ?? "",
    rfc_message_id: getHeader(headers, "Message-ID") || null,
    in_reply_to: getHeader(headers, "In-Reply-To") || null,
    references: parseReferences(getHeader(headers, "References")),
    from_email,
    from_name,
    to_emails: parseAddressList(getHeader(headers, "To")),
    cc_emails: parseAddressList(getHeader(headers, "Cc")),
    subject: getHeader(headers, "Subject"),
    body_html: body_html || `<pre>${text_fallback(body_text)}</pre>`,
    body_text,
    received_at,
  };
}

function text_fallback(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
