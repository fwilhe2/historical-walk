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
  drop: new Set([]),
  patch: {},
};
