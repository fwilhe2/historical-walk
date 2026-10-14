/* The cities the tools know: where to fetch, where the local frame's
   origin sits, and the year to show. Shared by fetch.ts and
   build-city.ts. */
export interface CitySpec {
  bbox: [number, number, number, number];   // south, west, north, east (degrees)
  origin: [number, number];                 // lat, lon of x = z = 0
  year: number;
}

export const CITIES: Record<string, CitySpec> = {
  // The walled town of 1900 — the excise wall's line from the
  // Brandenburger Tor round by the Jäger- and Nauener Tor to the
  // Berliner Tor, the Havel's bank with the Lange Brücke — and the
  // station and Teltower Vorstadt across the river.
  potsdam: { bbox: [52.388, 13.044, 52.407, 13.074], origin: [52.3953, 13.0605], year: 1900 },
};
