/* Potsdam, 1900. */
import type { History } from './index.ts';

export const POTSDAM: History = {
  name: 'Potsdam',
  // Inside the Brandenburger Tor (1770), looking east down the
  // Brandenburger Straße toward St. Peter und Paul.
  spawn: { lat: 52.39985, lon: 13.0512, yaw: -Math.PI / 2 },
  // The Havel lies about 1.5 m below the old streets' level at the
  // Lange Brücke; the Stadtkanal's water was at the river's level.
  water: -1.6,
  credits: [
    'Map data © OpenStreetMap contributors, ODbL',
    'Historical features: OpenHistoricalMap contributors, CC0',
    'Messtischblatt 3544/3644 (1903): © Staatsbibliothek zu Berlin – Preußischer Kulturbesitz, dl-de/by-2-0, via LGB Brandenburg',
  ],
  // The excise wall's line (OHM, 1733–1905) from the Brandenburger
  // Tor north and east round to the Berliner Tor, then back west along
  // the Havel's north bank, which closed the town on the south.
  town: [
    -845, -483, -898, -699, -539, -809, -199, -910, 136, -1006, 178, -784, 199, -671, 439, -494, 683, -488, 700, -420,
    // the Burgstraße's river side, keeping the island (a nursery
    // garden in 1900) and the Lange Brücke's foot out
    700, -250, 700, -185, 560, -140, 400, -105, 300, -75, 250, -50, 190, -5, 120, 65, 40, 120, -150, 280, -500, 240, -813, 126, -794, 42, -837, -33, -830, -95, -830, -415,
  ],
  drop: new Set([]),
  patch: {},
};
