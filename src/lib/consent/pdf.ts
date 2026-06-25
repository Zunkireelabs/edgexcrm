import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface ConsentPdfInput {
  title: string;
  body: string;
  organization: string;
  signerName: string;
  signedAt: string; // ISO timestamp
  ipAddress: string | null;
  userAgent: string | null;
  textHash: string; // SHA-256 hex of the exact consent body signed
  consentVersion: number | null;
  signature?: { bytes: Uint8Array; type: "png" | "jpg" } | null;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 50;
const CONTENT_WIDTH = A4[0] - MARGIN * 2;

// Helvetica (WinAnsi) can't encode arbitrary unicode — strip anything it can't draw.
function sanitize(text: string): string {
  return text.replace(/\r/g, "").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitize(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/**
 * Render a finalized, signed consent PDF: the filled consent text + the drawn
 * signature image + a full audit block (signer, server timestamp, IP,
 * user-agent, consent-text SHA-256). This document IS the permanent record.
 */
export async function generateConsentPdf(input: ConsentPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGIN;

  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - MARGIN;
  };
  const ensure = (h: number) => {
    if (y - h < MARGIN) newPage();
  };

  const draw = (
    text: string,
    size: number,
    f: PDFFont,
    color = rgb(0.13, 0.13, 0.13),
    gap = 4,
  ) => {
    for (const line of wrapLine(text, f, size, CONTENT_WIDTH)) {
      ensure(size + gap);
      page.drawText(line, { x: MARGIN, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };

  // Header
  draw(input.organization, 10, bold, rgb(0.4, 0.4, 0.4), 3);
  y -= 4;
  draw(input.title, 18, bold, rgb(0.1, 0.1, 0.1), 6);
  y -= 12;

  // Consent body — preserve the author's paragraph breaks
  for (const paragraph of input.body.split("\n")) {
    if (paragraph.trim() === "") {
      y -= 7;
      continue;
    }
    draw(paragraph, 11, font, rgb(0.15, 0.15, 0.15), 5);
    y -= 3;
  }

  // Signature
  y -= 22;
  ensure(40);
  draw("Signature", 12, bold, rgb(0.1, 0.1, 0.1), 4);
  y -= 4;
  if (input.signature) {
    const img =
      input.signature.type === "png"
        ? await pdf.embedPng(input.signature.bytes)
        : await pdf.embedJpg(input.signature.bytes);
    const scale = Math.min(200 / img.width, 80 / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    ensure(h + 8);
    page.drawImage(img, { x: MARGIN, y: y - h, width: w, height: h });
    y -= h + 8;
  }
  draw(`Signed by: ${input.signerName}`, 11, font, rgb(0.13, 0.13, 0.13), 4);

  // Audit trail
  y -= 16;
  ensure(96);
  draw("Audit Trail", 12, bold, rgb(0.1, 0.1, 0.1), 4);
  y -= 2;
  const audit = [
    `Signed at: ${new Date(input.signedAt).toUTCString()}`,
    `IP address: ${input.ipAddress ?? "unknown"}`,
    `User agent: ${input.userAgent ?? "unknown"}`,
    `Consent version: ${input.consentVersion != null ? `v${input.consentVersion}` : "—"}`,
    `Consent text SHA-256: ${input.textHash}`,
  ];
  for (const line of audit) draw(line, 9, font, rgb(0.35, 0.35, 0.35), 3);

  return pdf.save();
}
