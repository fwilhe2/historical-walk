/* ── Potsdam's landmarks of 1900, modelled part by part ─────────
   Each stands on its mapped footprint (OHM where it is lost, OSM
   where it stands), turned to face the way it faced. Heights are
   from the descriptions cited; where a description gives none, the
   number is an estimate from photographs and drawings and says so. */
import type { Landmark } from '../landmarks.ts';

const SANDSTONE = '#d9ccb0', PLASTER = '#e0d0ac', COPPER = '#6f9a85', SLATE = '#50555c', GOLD = '#d4af37';

export const LANDMARKS: Landmark[] = [
  {
    /* Garnisonkirche, Philipp Gerlach 1730–35. Tower 88.43 m, its
       lower storeys masonry, the top an oak-framed lantern clad in
       copper with a weathervane; it stood forward into the Breite
       Straße with the main portal. The nave behind, a transverse
       hall with a steep hipped roof about 17 m high (de.wikipedia,
       "Garnisonkirche (Potsdam)"). Stage sizes are estimates. */
    id: 'garnisonkirche', about: "Built 1730–35 to Philipp Gerlach's design for the garrison; its carillon played from the 88 m tower. Frederick William I and Frederick the Great were buried here. Burnt out on 14 April 1945, demolished 1968.", name: 'Garnisonkirche', year: 1735, at: [-452, -35], front: 180,
    build(P, ring) {
      const F = P.F, f = F.front - 7;
      P.footprint(ring, 0, 15, { colour: PLASTER, roof: 'hipped', roofH: 15, roofColour: SLATE, kind: 'church', storey: 7.5 });
      P.box(0, f, 14, 14, 0, 34, { colour: SANDSTONE, kind: 'church', storey: 8.5, wall: 'stone' });
      P.box(0, f, 12, 12, 34, 49, { colour: SANDSTONE, kind: 'church', storey: 7.5, wall: 'stone' });
      P.box(0, f, 10.4, 10.4, 49, 60, { colour: SANDSTONE, kind: 'church', storey: 5.5, wall: 'stone' });
      P.box(0, f, 8, 8, 60, 69, { colour: COPPER, wall: 'copper', windows: false });
      P.box(0, f, 5.6, 5.6, 69, 76, { colour: COPPER, wall: 'copper', windows: false });
      P.ngon(0, f, 2.6, 8, 76, 76.3, { colour: COPPER, wall: 'copper', windows: false, roof: 'spire', roofH: 12.1, roofColour: COPPER });
    },
  },
  {
    /* St. Nikolai, Schinkel 1830–37, dome 1843–50 (Persius, Stüler).
       Base 30 × 30 m, 27 m to the main cornice; four corner towers
       45 m with angels; drum 22.5 m with 28 Corinthian columns of
       about 10 m; outer dome about 24 m across and 13 m high, copper
       on cast iron; lantern 14.5 m; 77 m to the cross. Portico of six
       Corinthian columns to the Alter Markt (south), apse to the
       north (de.wikipedia, "Nikolaikirche (Potsdam)"). */
    id: 'nikolaikirche', about: "Karl Friedrich Schinkel's church, built 1830–37; the dome on its colonnaded drum followed 1843–50 under Persius and Stüler. 77 m to the cross.", name: 'St. Nikolaikirche', year: 1850, at: [30, -110], front: 180,
    build(P) {
      const s = { colour: SANDSTONE, kind: 'church' as const, wall: 'stone' as const, storey: 9 };
      P.box(0, 0, 30, 30, 0, 27, s);
      for (const u of [-12.5, 12.5]) for (const f of [-12.5, 12.5]) P.box(u, f, 6.4, 6.4, 0, 41.5, { ...s, roof: 'pyramidal', roofH: 3.5, roofColour: COPPER });
      P.ngon(0, 0, 12.6, 28, 27, 49.5, { ...s, storey: 11 });
      P.colonnade(0, 0, 13.6, 28, 0.45, 10, 27);
      P.ngon(0, 0, 12.2, 28, 49.5, 49.8, { colour: COPPER, wall: 'copper', windows: false, roof: 'dome', roofH: 13, roofColour: COPPER });
      P.ngon(0, 0, 2.4, 8, 62.8, 71.5, { colour: SANDSTONE, wall: 'stone', windows: false, roof: 'dome', roofH: 2, roofColour: COPPER });
      P.ngon(0, 0, 0.5, 6, 73.5, 74, { colour: GOLD, wall: 'copper', windows: false, roof: 'spire', roofH: 3, roofColour: GOLD });
      // the portico: six columns and a pediment
      for (let k = 0; k < 6; k++) P.column(-10 + 4 * k, 19.5, 0.75, 13.5, 0);
      P.box(0, 18.5, 23, 6, 13.5, 16, { colour: SANDSTONE, wall: 'stone', windows: false, roof: 'gabled', roofH: 4, ridgeAlong: 'front', roofColour: SLATE });
      // the apse
      P.ngon(0, -15, 8, 16, 0, 17, { ...s, roof: 'dome', roofH: 3, roofColour: COPPER });
    },
  },
  {
    /* Altes Rathaus, Boumann 1753–55: seven bays, eight Corinthian
       three-quarter columns, two main storeys and an attic with six
       figures; a drum with eight windows and a stepped copper cupola
       carrying the gilded Atlas with the globe (de.wikipedia, "Altes
       Rathaus (Potsdam)"). Heights estimated. */
    id: 'rathaus', about: 'The town hall, 1753–55, by Jan Bouman after a Palladian model; a gilded Atlas carries the globe on its cupola.', name: 'Altes Rathaus', year: 1755, at: [106, -79], front: 285,
    build(P, ring) {
      P.footprint(ring, 0, 18, { colour: '#dccfae', kind: 'public', storey: 6.5 });
      P.ngon(0, 0, 4.4, 8, 18, 25, { colour: SANDSTONE, wall: 'stone', storey: 6 });
      P.ngon(0, 0, 4.6, 8, 25, 25.3, { colour: COPPER, wall: 'copper', windows: false, roof: 'dome', roofH: 4.5, roofColour: COPPER });
      P.ngon(0, 0, 0.7, 8, 29.6, 31.2, { colour: GOLD, wall: 'copper', windows: false });
      P.ngon(0, 0, 1.4, 12, 31.2, 32.4, { colour: GOLD, wall: 'copper', windows: false, roof: 'dome', roofH: 1.4, roofColour: GOLD });
    },
  },
  {
    /* St. Peter und Paul, Stüler and Salzenberg 1867–70: yellow brick,
       a Greek cross about 65 × 38 m, and a 64 m campanile after San
       Zeno in Verona closing the view down the Brandenburger Straße
       from the west (de.wikipedia, "St. Peter und Paul (Potsdam)"). */
    id: 'peterpaul', about: 'The Catholic parish church, 1867–70, by Wilhelm Salzenberg after a design by Friedrich August Stüler; its campanile follows San Zeno in Verona.', name: 'St. Peter und Paul', year: 1870, at: [-49, -639], front: 270,
    build(P, ring) {
      const brick = { colour: '#d4b878', wall: 'brick' as const, kind: 'church' as const, storey: 8 };
      P.footprint(ring, 0, 16, { ...brick, roof: 'hipped', roofH: 8, roofColour: SLATE });
      P.box(0, P.F.front - 5, 10, 10, 0, 49, { ...brick, storey: 10 });
      P.box(0, P.F.front - 5, 10.6, 10.6, 49, 50, { ...brick, windows: false, roof: 'spire', roofH: 14, roofColour: '#8e5a40' });
    },
  },
  {
    /* Heilig-Geist-Kirche, Gayette 1726–28, tower by Grael 1734:
       86 m, square, 12.40 m wide, on the west end in the axis of the
       Burgstraße; masonry below, timber clad in copper above; the
       nave 13.6 m wide, plain plaster with pilaster strips (Residenz
       Heilig Geist Park, church history; de.wikipedia). Stage
       heights estimated. */
    id: 'heiliggeist', about: 'Nave 1726–28 by Pierre de Gayette, tower 1734 by Johann Friedrich Grael, 86 m over the Havel. Burnt 1945; the nave was pulled down in 1961, the tower blown up in 1974.', name: 'Heilig-Geist-Kirche', year: 1734, at: [670, -194], front: 280,
    build(P, ring) {
      const f = P.F.front - 6.2;
      P.footprint(ring, 0, 15, { colour: PLASTER, kind: 'church', roof: 'hipped', roofH: 8, roofColour: COPPER, storey: 7.5 });
      P.box(0, f, 12.4, 12.4, 0, 42, { colour: PLASTER, kind: 'church', storey: 8.5 });
      P.box(0, f, 9.6, 9.6, 42, 55, { colour: COPPER, wall: 'copper', windows: false });
      P.box(0, f, 7.2, 7.2, 55, 65, { colour: COPPER, wall: 'copper', windows: false });
      P.ngon(0, f, 3.4, 8, 65, 72, { colour: COPPER, wall: 'copper', windows: false });
      P.ngon(0, f, 2.2, 8, 72, 72.3, { colour: COPPER, wall: 'copper', windows: false, roof: 'spire', roofH: 13.7, roofColour: COPPER });
    },
  },
  {
    /* Französische Kirche, Knobelsdorff and Boumann 1752–53: a small
       oval domed temple on the Bassinplatz. Heights estimated. */
    id: 'franzkirche', about: "The Huguenot congregation's church, 1752–53, by Jan Bouman after Knobelsdorff: a small oval temple under a dome.", name: 'Französische Kirche', year: 1753, at: [149, -586], front: 270,
    build(P, ring) {
      P.footprint(ring, 0, 9.5, { colour: '#e2d8c2', kind: 'church', storey: 7, roof: 'dome', roofH: 6.5, roofColour: SLATE });
    },
  },
  {
    /* Stadtschloss, rebuilt by Knobelsdorff 1744–52 on the old
       four-wing plan; the Fortunaportal of 1701 (de Bodt) with its
       gilded Fortuna on the dome in the middle of the north front to
       the Alter Markt. Wall and portal heights estimated from the
       2013 reconstruction of its outer shape. */
    id: 'stadtschloss', about: "The Hohenzollerns' town palace, remodelled by Georg Wenzeslaus von Knobelsdorff 1744–52; the Fortunaportal of 1701 faces the Alter Markt. Burnt out 1945, demolished 1959–60.", name: 'Stadtschloss', year: 1752, at: [-1, 34], front: 0,
    build(P, ring) {
      P.footprint(ring, 0, 18, { colour: '#d8b09c', kind: 'palace', roof: 'hipped', roofH: 6, roofColour: COPPER, storey: 5.6 });
      const f = P.F.front - 4;
      P.box(0, f, 12, 9, 0, 19, { colour: SANDSTONE, wall: 'stone', kind: 'palace', storey: 6 });
      P.ngon(0, f, 4.6, 16, 19, 23, { colour: SANDSTONE, wall: 'stone', windows: false });
      P.ngon(0, f, 4.6, 16, 23, 23.2, { colour: COPPER, wall: 'copper', windows: false, roof: 'dome', roofH: 4.2, roofColour: COPPER });
      P.ngon(0, f, 0.8, 8, 27.4, 29.5, { colour: GOLD, wall: 'copper', windows: false });
    },
  },
  {
    /* Brandenburger Tor, Gontard and Unger 1770: a triumphal arch with
       one carriage arch and, since 1843, a footway through each side.
       Proportions estimated; you can walk through. */
    id: 'brandenburgertor', about: 'A triumphal arch of 1770 by Carl von Gontard and Georg Christian Unger — the town side and the field side were designed differently.', name: 'Brandenburger Tor', year: 1770, at: [-846, -473], front: 270,
    build(P) {
      const s = { colour: '#e6dcc4', wall: 'stone' as const, windows: false as const };
      const W = P.F.left + P.F.right, D = Math.min(P.F.front + P.F.back, 8);
      const k = W / 20.2;
      const piers = [[-8.85, 2.5], [-4.4, 2.5], [4.4, 2.5], [8.85, 2.5]] as const;
      for (const [u, w] of piers) P.box(u * k, 0, w * k, D, 0, 12, s);
      for (const u of [-6.6, 6.6]) P.box(u * k, 0, 2.4 * k, D, 4.6, 12, s);   // over the footways
      P.box(0, 0, 5.4 * k, D, 9.2, 12, s);                                     // over the arch
      P.box(0, 0, W, D + 0.6, 12, 14.6, { ...s, colour: '#ddd2b8' });           // the attic
    },
  },
  {
    /* Nauener Tor, 1755: the first neo-Gothic building on the
       continent — two slender round towers with crenellations either
       side of a pointed arch, and a guardhouse wing on each side, all
       on the mapped outline (OSM). Heights estimated from photographs. */
    id: 'nauenertor', about: 'Built 1755 — one of the first neo-Gothic buildings on the European continent.', name: 'Nauener Tor', year: 1755, at: [-190, -912], front: 0,
    build(P, ring) {
      const s = { colour: '#dcc6a0', wall: 'stone' as const, kind: 'church' as const, storey: 4.6 };
      P.footprint(ring, 0, 9.5, s);
      for (const [x, z] of [[-170, -907.9], [-181.2, -907.9]] as const) {
        P.ngonAt(x, z, 3.1, 12, 0, 17.5, { ...s, storey: 5.5 });
        P.ngonAt(x, z, 3.5, 12, 17.5, 19, { ...s, windows: false });
      }
    },
  },
  {
    /* Jägertor, 1733: two piers and a lintel carrying a hunting group
       — a stag brought down by hounds. Estimated. */
    id: 'jaegertor', about: "The hunters' gate of 1733, crowned by a stag brought down by hounds; the oldest of Potsdam's gates still standing.", name: 'Jägertor', year: 1733, at: [-532, -808], front: 0,
    build(P) {
      const W = P.F.left + P.F.right;
      const s = { colour: '#e0d4ba', wall: 'stone' as const, windows: false as const };
      for (const u of [-(W / 2 - 1.4), W / 2 - 1.4]) P.box(u, 0, 2.8, 2.6, 0, 7.5, s);
      P.box(0, 0, W, 2.6, 6, 7.5, s);
      P.box(0, 0, 3.2, 1.6, 7.5, 9.6, { ...s, colour: '#cbbf9f' });
    },
  },
  {
    /* The Obelisk on the Alter Markt, Knobelsdorff 1753–55: almost
       20 m in all (potsdam.de), a 16 m shaft (potsdam-wiki) on a
       stepped base with medallions of the four rulers. Shaft width
       estimated. */
    id: 'obelisk', name: 'Obelisk', year: 1755, at: [46, -62], front: 0,
    about: 'Knobelsdorff\'s obelisk of 1753–55, almost 20 m high, its base carrying medallions of the Great Elector and the first three kings.',
    build(P) {
      const s = { colour: '#e4d9c6', wall: 'stone' as const, windows: false as const };
      P.box(0, 0, 5.2, 5.2, 0, 0.8, s);
      P.box(0, 0, 3.6, 3.6, 0.8, 3.6, s);
      P.box(0, 0, 2.2, 2.2, 3.6, 17.2, { ...s, colour: '#d8cdb8' });
      P.box(0, 0, 2.3, 2.3, 17.2, 17.3, { ...s, roof: 'pyramidal', roofH: 2.4, roofColour: '#d8cdb8' });
    },
  },
  {
    /* The Dampfmaschinenhaus for Sanssouci, Ludwig Persius 1841–43, a
       pump house in the form of a mosque: a domed hall after the
       Mezquita of Córdoba and the chimney as a minaret, 36 m (db
       deutsche bauzeitung; potsdam-wiki gives 38 m). The minaret's
       place on the footprint and the hall's heights are estimates. */
    id: 'dampfmaschinenhaus', name: 'Dampfmaschinenhaus', year: 1843, at: [-1084, -106], front: 180,
    about: 'The pump house that fed the fountains of Sanssouci, built 1841–43 by Ludwig Persius as a mosque, its chimney a 36 m minaret.',
    build(P, ring) {
      const s = { colour: '#d8b48a', wall: 'stone' as const, kind: 'church' as const, storey: 6 };
      P.footprint(ring, 0, 9.5, s);
      P.ngon(0, 0, 6.5, 16, 9.5, 13.5, { ...s, windows: false });
      P.ngon(0, 0, 6.5, 16, 13.5, 13.7, { colour: '#c9a476', wall: 'stone', windows: false, roof: 'dome', roofH: 5.5, roofColour: '#b98d5c' });
      const u = P.F.right - 2.2, f = P.F.front - 2.2;
      P.ngon(u, f, 1.5, 12, 0, 27, { ...s, windows: false });
      P.ngon(u, f, 2.2, 12, 27, 28.2, { ...s, windows: false });
      P.ngon(u, f, 1.2, 12, 28.2, 33, { ...s, windows: false });
      P.ngon(u, f, 1.25, 12, 33, 33.1, { colour: '#c9a476', wall: 'stone', windows: false, roof: 'dome', roofH: 3, roofColour: '#b98d5c' });
    },
  },
  {
    /* The Langer Stall: the garrison's riding and drill hall of 1734
       (Gayette), half-timbered, 167 m by 23 m under one roof. In 1781
       Georg Christian Unger set a show front before its south gable on
       the Breite Straße: five bays, a rusticated ground storey as a
       base, a four-column Tuscan temple front with a pediment, and an
       attic with Mars between Hercules and Minerva; in 1785 a massive
       three-storey Montierungshaus closed the north end (potsdam.de,
       veikkos-archiv). Heights estimated. */
    id: 'langerstall', name: 'Langer Stall', year: 1781, at: [-414, -94], front: 180,
    about: 'The garrison\'s drill hall of 1734, 167 m long under one roof; Georg Christian Unger\'s show front of 1781 faces the Breite Straße. Burnt 1945 — the front still stands.',
    build(P, ring) {
      const F = P.F, W = F.left + F.right;
      P.footprint(ring, 0, 9, { colour: '#cdbb98', kind: 'public', roof: 'hipped', roofH: 8, roofColour: '#8e4a35', storey: 9 });
      // the Montierungshaus at the north end
      P.box(0, -F.back + 13, W, 26, 0, 12.5, { colour: '#d9c7a2', roof: 'hipped', roofH: 6, roofColour: '#8e4a35', storey: 3.9 });
      // the show front: base, upper wall, columns, entablature and pediment, Mars
      const f = F.front + 1.4, s = { colour: '#e2d7bf', wall: 'stone' as const, kind: 'palace' as const, storey: 6 };
      P.box(0, f, W, 3, 0, 6, s);
      P.box(0, f - 0.4, W, 2.2, 6, 16, { ...s, storey: 10 });
      for (const u of [-4.5, -1.5, 1.5, 4.5]) P.column(u, f + 2.2, 0.55, 8.6, 6);
      P.box(0, f + 1.3, 12, 3.2, 14.6, 16, { ...s, windows: false, roof: 'gabled', roofH: 3.2, ridgeAlong: 'front', roofColour: '#d6cbb3' });
      P.box(0, f - 0.4, W, 2.2, 16, 17.2, { ...s, windows: false });
      P.ngon(0, f, 0.6, 8, 17.2, 20.2, { colour: '#cfc3a8', wall: 'stone', windows: false, roof: 'spire', roofH: 0.6, roofColour: '#cfc3a8' });
    },
  },
];
