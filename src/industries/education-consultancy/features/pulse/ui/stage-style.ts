/** Stage chip colours, straight from the mockup (.s-pq / .s-q / .s-p / .s-a). */
export function stageChipClass(nameOrSlug: string | null | undefined): string {
  const n = (nameOrSlug ?? "").toLowerCase();
  if (n.includes("pre-qual") || n.includes("pre_qual")) return "bg-[#f1f5f9] text-[#475569]";
  if (n.includes("qualif")) return "bg-[#e0ecf8] text-[#1e5a8f]";
  if (n.includes("prospect")) return "bg-[#ede9fe] text-[#6d28d9]";
  if (n.includes("application")) return "bg-[#d1fae5] text-[#047857]";
  if (n.includes("archiv")) return "bg-[#f3f4f6] text-[#6b7280]";
  return "bg-[#f1f5f9] text-[#475569]";
}
