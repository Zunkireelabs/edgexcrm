import { describe, it, expect } from "vitest";
import { checkLogoFile, MAX_LOGO_BYTES, sniffLogoType } from "./logo";

const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const jpeg = [0xff, 0xd8, 0xff, 0xe0];
const webp = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50];
const bytes = (head: number[], total = head.length) => {
  const out = new Uint8Array(total);
  out.set(head);
  return out;
};

describe("sniffLogoType", () => {
  it("recognizes PNG, JPEG and WebP by their first bytes", () => {
    expect(sniffLogoType(bytes(png))).toBe("image/png");
    expect(sniffLogoType(bytes(jpeg))).toBe("image/jpeg");
    expect(sniffLogoType(bytes(webp))).toBe("image/webp");
  });

  it("refuses SVG, HTML, GIF and anything else, whatever it is called", () => {
    const text = (t: string) => new TextEncoder().encode(t);
    expect(sniffLogoType(text("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"))).toBeNull();
    expect(sniffLogoType(text("<!DOCTYPE html><html></html>"))).toBeNull();
    expect(sniffLogoType(text("GIF89a"))).toBeNull();
    expect(sniffLogoType(new Uint8Array([]))).toBeNull();
  });

  it("does not take a RIFF file that is not WebP (for example WAV)", () => {
    expect(sniffLogoType(bytes([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
  });
});

describe("checkLogoFile", () => {
  it("accepts a real image and picks the file name itself", () => {
    expect(checkLogoFile(bytes(png, 100))).toEqual({ ok: true, type: "image/png", name: "chat-logo.png" });
    expect(checkLogoFile(bytes(jpeg, 100))).toMatchObject({ ok: true, name: "chat-logo.jpg" });
    expect(checkLogoFile(bytes(webp, 100))).toMatchObject({ ok: true, name: "chat-logo.webp" });
  });

  it("refuses an empty file, an oversized file and a non-image, each with a plain reason", () => {
    expect(checkLogoFile(new Uint8Array([]))).toMatchObject({ ok: false, error: expect.stringContaining("empty") });
    expect(checkLogoFile(bytes(png, MAX_LOGO_BYTES + 1))).toMatchObject({ ok: false, error: expect.stringContaining("too big") });
    expect(checkLogoFile(new TextEncoder().encode("<svg></svg>"))).toMatchObject({ ok: false, error: expect.stringContaining("SVG") });
  });

  it("accepts a file of exactly the size limit", () => {
    expect(checkLogoFile(bytes(png, MAX_LOGO_BYTES))).toMatchObject({ ok: true });
  });
});
