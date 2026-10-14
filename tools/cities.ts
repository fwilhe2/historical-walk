/* The cities the tools know: where to fetch, where the local frame's
   origin sits, and the year to show. Shared by fetch.ts and
   build-city.ts. */
export interface CitySpec {
  bbox: [number, number, number, number];   // south, west, north, east (degrees)
  origin: [number, number];                 // lat, lon of x = z = 0
  year: number;
  // A georeferenced historical map from a WMS, fetched over bbox.
  region?: [number, number, number, number];   // a wider box for the land round the town (water, woods, parks)
  map?: { wms: string; layer: string; mpp: number; file: string; date: string };
}

export const CITIES: Record<string, CitySpec> = {
  // The walled town of 1900 — the excise wall's line from the
  // Brandenburger Tor round by the Jäger- and Nauener Tor to the
  // Berliner Tor, the Havel's bank with the Lange Brücke — and the
  // station and Teltower Vorstadt across the river.
  potsdam: {
    bbox: [52.388, 13.044, 52.407, 13.074], origin: [52.3953, 13.0605], year: 1900,
    region: [52.365, 13.0, 52.43, 13.12],
    // Messtischblätter 3544 and 3644, both of 1 January 1903 by the
    // WMS's own currency layer (bb_dr25_info).
    map: { wms: 'https://isk.geobasis-bb.de/mapproxy/dr25/service/wms', layer: 'dr25', mpp: 1, file: 'mtb1903.png', date: '1903-01-01' },
  },
};
