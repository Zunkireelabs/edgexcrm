function memberHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

// Hash a stable seed (use user_id, NOT email — survives renames) into a deterministic two-tone gradient.
export function memberGradient(seed: string): string {
  const hue = memberHue(seed);
  const hue2 = (hue + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 72%), hsl(${hue2} 68% 62%))`;
}

/** Dark, same-hue text color so initials stay legible on the pastel gradient. */
export function memberInitialsColor(seed: string): string {
  return `hsl(${memberHue(seed)} 55% 28%)`;
}

/** "Deepika Agrawal" → "DA", "Manjila" → "M", "yukta" → "Y". */
export function getInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
