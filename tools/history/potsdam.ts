/* Potsdam, 1900. */
import type { History } from './index.ts';
import { LANDMARKS } from './potsdam-landmarks.ts';

export const POTSDAM: History = {
  name: 'Potsdam',
  // Just inside the Brandenburger Tor (1770), looking east down the
  // Brandenburger Straße toward St. Peter und Paul at its far end.
  spawn: { x: -795, z: -484, yaw: -1.366 },
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
  landmarks: LANDMARKS,
  // Where no OHM street of 1900 lies along today's, these renamings
  // (post-1918 and post-1945 names back to the old ones) apply. Only
  // certain ones; the rest keep today's name rather than a guess.
  rename: {
    'Am Alten Markt': 'Alter Markt',
    'Am Neuen Markt': 'Neuer Markt',
    'Platz der Einheit': 'Wilhelmplatz',
    'Henning-von-Tresckow-Straße': 'Priesterstraße',
    'Zeppelinstraße': 'Neue Königstraße',
    'Friedrich-Ebert-Straße': 'Nauener Straße',
    'Dortustraße': 'Junkerstraße',
  },
  // The Stadtkanal (1722, walled in sandstone with an iron railing
  // under Frederick II, filled 1962–65): 1.84 km, nine bridges. No
  // source found gives its width; about 9 m between the walls is an
  // estimate from the reopened stretch on the Yorckstraße.
  canalWidth: { Stadtkanal: 9 },
  squares: [
    // Between St. Nikolai's portico, the Schloss's north front with the
    // Fortunaportal, the Rathaus and the corner of the colonnade; the
    // obelisk (1755) in its middle.
    { name: 'Alter Markt', ring: [-45, -88, 100, -98, 104, -25, 60, -20, -45, -20] },
  ],
  drop: new Set([]),
  patch: {},
};
