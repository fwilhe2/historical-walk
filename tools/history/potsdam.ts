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
    'Elevation: Terrarium tiles, AWS Open Data (Mapzen; SRTM, EU-DEM)',
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
  // Laid out on the old town's rebuilt blocks by the Alter Markt and
  // the canal (2016–) and on the Plantage beside the Garnisonkirche's
  // site; named after people of the 20th century.
  newStreets: ['Anna-Zielenziger-Straße', 'Anna-Flügge-Straße', 'Werner-Seelenbinder-Straße', 'Neue Plantage'],
  // the busy middle: the old town and the baroque extension
  centre: [-200, -350, 650],
  // the Garnisonkirche's carillon tower struck the hours; St. Nikolai the quarters
  bells: { hours: 'Garnisonkirche', quarters: 'St. Nikolaikirche' },
  mapCaption: 'Messtischblatt 3544/3644 · 1903 · © SBB-PK, dl-de/by-2-0',
  // The town's shopping streets about 1900: the Brandenburger Straße
  // above all, the Nauener Straße, the Linden- and Charlottenstraße's
  // ends, the Schwertfegerstraße and the streets round the Alter Markt.
  shopStreets: ['Brandenburger Straße', 'Nauener Straße', 'Schwertfegerstraße', 'Brauerstraße', 'Friedrich-Ebert-Straße', 'Charlottenstraße', 'Lindenstraße', 'Alter Markt', 'Am Kanal', 'Breite Straße'],
  // Boards over the shops: the trades of a Prussian town about 1900, in
  // the spelling of before the reform of 1901 (Waaren, Cigarren, C for
  // K), and the owner's name as such boards gave it. Illustrative: the
  // names are made up and placed by chance, not the shops that were there.
  signs: [
    'COLONIALWAAREN', 'BÄCKEREI & CONDITOREI', 'FLEISCHEREI', 'CIGARREN & TABAKE', 'UHRMACHER', 'BUCHHANDLUNG',
    'MANUFACTURWAAREN', 'WEINHANDLUNG', 'FRISEUR', 'EISENWAAREN', 'HUTMACHER', 'SCHUHWAAREN', 'DROGERIE',
    'DELICATESSEN', 'GLAS · PORZELLAN', 'GOLD- U. SILBERWAAREN', 'KURZ-, WEISS- U. WOLLWAAREN', 'CAFÉ', 'MÖBEL-MAGAZIN',
    'PHOTOGRAPHISCHES ATELIER', 'SEIFEN & PARFÜMERIEN', 'BUTTER · KÄSE · EIER', 'LEDERWAAREN', 'OPTIKER',
    'C. MÜLLER', 'H. SCHULZE', 'WILH. KRAUSE', 'GEBR. LEHMANN', 'AUG. RICHTER', 'F. W. HOFFMANN', 'CARL BRANDT', 'J. G. SCHMIDT NACHF.',
  ],
  // The royal gardens round the town, all laid out before 1900.
  regionParks: ['Park Sanssouci', 'Park Babelsberg', 'Neuer Garten', 'Glienicker Park', 'Schlossgarten Glienicke', 'Schlosspark Sacrow',
    'Jagdschlosspark', 'Marlygarten', 'Sizilianischer Garten', 'Nordischer Garten', 'Paradiesgarten', 'Holländischer Garten'],
  about: {
    'Marstall': 'The royal stables: built 1685 as an orangery, a stable from 1714, remodelled by Knobelsdorff in 1746 with horse-tamer groups on the roof.',
    'Kommandantur': 'The garrison commander\'s house on the Lustgarten, 1819 on an older inn. Destroyed 1945.',
    'Palast Barberini': 'A town palace of 1771–72 by Carl von Gontard after the Palazzo Barberini in Rome. Destroyed 1945, rebuilt 2013–16.',
    'Königliches Schauspielhaus': 'The royal theatre of 1795 on the Canal, by Michael Philipp Boumann. Destroyed in 1945.',
    'Großes Militär-Waisenhaus': 'The Great Military Orphanage, founded 1724, rebuilt 1771–78 by Carl von Gontard with its domed tower.',
  },
  // Where no OHM street of 1900 lies along today's, these renamings
  // (post-1918 and post-1945 names back to the old ones) apply. Only
  // certain ones; the rest keep today's name rather than a guess.
  // The old town south of the canal: "the area between the Havel, the
  // Alter Markt and the Bassinplatz was hit hardest" on 14 April 1945,
  // only four buildings of the Alter Markt's ensemble survived, and the
  // quarter was rebuilt in the 1960s–70s to another plan (potsdam.de,
  // "Alter Markt"; de.wikipedia, "Luftangriff auf Potsdam"). Bounded
  // here, conservatively, by the canal on the north.
  lost: [{
    name: 'Altstadt',
    ring: [-60, -90, -140, -198, 780, -446, 790, -200, 700, -185, 560, -140, 400, -105, 300, -75, 250, -50, 190, -5, 120, 65, 40, 120, -60, 40],
  }],
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
    // obelisk (1755) in its middle. Paved with setts, as photographs of
    // about 1900 show it (the pattern of the setts is not known: rows).
    { name: 'Alter Markt', ring: [-45, -88, 100, -98, 104, -25, 60, -20, -45, -20], paving: 'setts' },
    // South of the Breite Straße west of the Lustgarten the 1903 map
    // marks a barracks ("Kas.") round an open yard — a sandy drill
    // ground, whose scattered tree symbols read as blocks. Outline from
    // the map. (The barracks buildings, drawn solid black on its south
    // side, are not yet modelled.)
    { name: 'Kasernenhof', ring: [-575, 62, -400, 62, -400, 195, -575, 195] },
  ],
  drop: new Set([]),
  patch: {
    // The Gloriette on the Bassinplatz (1739–1945, OHM): a garden
    // pavilion, not a house — blank walls under a small dome. Form
    // estimated.
    // The Kutschpferdestall (1787–89, standing today): two storeys
    // round its court under a mansard roof. Estimated.
    'ohm:r2854909': { eave: 8.4, roof: 'mansard', roofH: 5, kind: 'house', storey: 3.9 },
    // The Marstall: one tall storey of arched windows under a mansard,
    // Knobelsdorff's horse-tamers on the roof. Estimated.
    // The orphanage: four storeys under a mansard (Gontard 1771–78).
    'w28490429': { eave: 17.8, roof: 'mansard', roofH: 5.5, storey: 4.3, kind: 'palace' },
    'ohm:r2854322': { eave: 8.5, roof: 'mansard', roofH: 5.5, kind: 'palace', storey: 7.9 },
    // Gates drawn as buildings: stone, no windows.
    'ohm:w201138821': { eave: 9, roof: 'flat', roofH: 0, windows: false, wall: 'stone', kind: 'gate', colour: '#e3d8c0' },
    'ohm:r2856679': { windows: false, wall: 'stone', colour: '#e3d8c0' },
    'ohm:w200905633': { eave: 5.5, roof: 'dome', roofH: 3, windows: false, wall: 'stone', colour: '#e3d8c0', roofColour: '#6f9a85', kind: 'public' },
  },
};
