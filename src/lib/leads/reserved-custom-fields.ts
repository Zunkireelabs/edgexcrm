// Custom-field keys that have their own dedicated UI (the Trip Inquiry panel and
// the Itinerary builder, travel_agency) and must NOT leak into the generic
// custom-field renderers (Professional Details, Key Information → Additional
// Details). Structured values like `itinerary` would otherwise render as
// "[object Object]", and trip_* fields would duplicate the Trip Inquiry panel.
export function isReservedCustomField(key: string): boolean {
  return key === "itinerary" || key.startsWith("trip_");
}
