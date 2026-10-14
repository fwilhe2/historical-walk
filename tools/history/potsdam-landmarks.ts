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
    id: 'garnisonkirche', name: 'Garnisonkirche', year: 1735, at: [-452, -35], front: 180,
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
    id: 'nikolaikirche', name: 'St. Nikolaikirche', year: 1850, at: [30, -110], front: 180,
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
    id: 'rathaus', name: 'Altes Rathaus', year: 1755, at: [106, -79], front: 285,
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
    id: 'peterpaul', name: 'St. Peter und Paul', year: 1870, at: [-49, -639], front: 270,
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
    id: 'heiliggeist', name: 'Heilig-Geist-Kirche', year: 1734, at: [670, -194], front: 280,
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
    id: 'franzkirche', name: 'Französische Kirche', year: 1753, at: [149, -586], front: 270,
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
    id: 'stadtschloss', name: 'Stadtschloss', year: 1752, at: [-1, 34], front: 0,
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
    id: 'brandenburgertor', name: 'Brandenburger Tor', year: 1770, at: [-846, -473], front: 270,
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
    id: 'nauenertor', name: 'Nauener Tor', year: 1755, at: [-190, -912], front: 0,
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
    id: 'jaegertor', name: 'Jägertor', year: 1733, at: [-532, -808], front: 0,
    build(P) {
      const W = P.F.left + P.F.right;
      const s = { colour: '#e0d4ba', wall: 'stone' as const, windows: false as const };
      for (const u of [-(W / 2 - 1.4), W / 2 - 1.4]) P.box(u, 0, 2.8, 2.6, 0, 7.5, s);
      P.box(0, 0, W, 2.6, 6, 7.5, s);
      P.box(0, 0, 3.2, 1.6, 7.5, 9.6, { ...s, colour: '#cbbf9f' });
    },
  },
];
