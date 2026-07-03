import type { scopedClient } from "@/lib/supabase/scoped";

export function computeProposalTotals(
  lines: { quantity: number; unit_price: number }[],
  discountType: "percent" | "amount" | null,
  discountValue: number,
  taxPercent: number,
): { subtotal: number; total: number } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0));
  const discount = discountType === "percent"
    ? round2(subtotal * (discountValue / 100))
    : discountType === "amount" ? Math.min(discountValue, subtotal) : 0;
  const taxed = round2((subtotal - discount) * (taxPercent / 100));
  const total = round2(subtotal - discount + taxed);
  return { subtotal, total };
}

type ScopedDb = Awaited<ReturnType<typeof scopedClient>>;

export async function recomputeAndPersistTotals(db: ScopedDb, proposalId: string) {
  const { data: proposal } = await db
    .from("proposals")
    .select("discount_type, discount_value, tax_percent")
    .eq("id", proposalId)
    .maybeSingle();
  const proposalRow = proposal as unknown as {
    discount_type: "percent" | "amount" | null;
    discount_value: number;
    tax_percent: number;
  } | null;
  if (!proposalRow) return null;

  const { data: lineItems } = await db
    .from("proposal_line_items")
    .select("quantity, unit_price")
    .eq("proposal_id", proposalId);
  const lines = (lineItems ?? []) as unknown as { quantity: number; unit_price: number }[];

  const { subtotal, total } = computeProposalTotals(
    lines,
    proposalRow.discount_type,
    proposalRow.discount_value,
    proposalRow.tax_percent
  );

  const { data: updated } = await db
    .from("proposals")
    .update({ subtotal, total })
    .eq("id", proposalId)
    .select()
    .single();

  return updated;
}
