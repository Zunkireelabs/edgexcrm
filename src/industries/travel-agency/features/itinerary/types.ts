export type LineItemCategory =
  | "hotel"
  | "flight"
  | "transfer"
  | "activity"
  | "meal"
  | "other";

export interface ItineraryDay {
  id: string;
  title: string;
  description: string;
}

export interface ItineraryLineItem {
  id: string;
  category: LineItemCategory;
  label: string;
  qty: number;
  unitPrice: number;
}

export interface Itinerary {
  title: string;
  currency: string;
  days: ItineraryDay[];
  lineItems: ItineraryLineItem[];
  notes: string;
  updatedAt: string;
}

export const LINE_ITEM_CATEGORIES: { value: LineItemCategory; label: string }[] = [
  { value: "hotel", label: "Hotel" },
  { value: "flight", label: "Flight" },
  { value: "transfer", label: "Transfer" },
  { value: "activity", label: "Activity" },
  { value: "meal", label: "Meal" },
  { value: "other", label: "Other" },
];

export function emptyItinerary(destination?: string, nights?: number | null): Itinerary {
  const title = destination
    ? `${destination}${nights ? ` — ${nights}N trip` : ""}`
    : "Untitled itinerary";
  return {
    title,
    currency: "NPR",
    days: [],
    lineItems: [],
    notes: "",
    updatedAt: new Date().toISOString(),
  };
}

export function lineItemTotal(item: ItineraryLineItem): number {
  return item.qty * item.unitPrice;
}

export function grandTotal(items: ItineraryLineItem[]): number {
  return items.reduce((sum, i) => sum + lineItemTotal(i), 0);
}
