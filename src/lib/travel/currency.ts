const CURRENCIES: Record<string, string> = {
  NPR: "Rs.",
  USD: "$",
  INR: "₹",
  EUR: "€",
};

export function formatMoney(amount: number, currency = "NPR"): string {
  const symbol = CURRENCIES[currency] ?? currency;
  return `${symbol} ${amount.toLocaleString("en-IN")}`;
}
