/* Build a city for the app from the reduced map data (tools/fetch.ts).

   Usage: node tools/build-city.ts [city]   → src/cities/<city>/city.json

   What is shown is decided feature by feature, from the data's own
   dates where it has them:
   - OpenHistoricalMap features are kept when they stand in the year
     (start_date ≤ year < end_date).
   - OpenStreetMap buildings with a start_date are kept when it is on or
     before the year; undated ones are judged by the historical
     map (tools/mask.ts) and by what OHM says stood on the spot.
   See README.md, "Where the city comes from". */
import { mkdirSync, writeFileSync } from 'node:fs';
import { CITIES } from './cities.ts';
import { aliveIn, load, projector, year, type Feature, type Pt, type Tags } from './osm.ts';
import { area, bbox, buffer, centroid, inside, inset, obb, orient, segDist2, simplify, straighten, type Ring } from '../src/geom/poly.ts';
import type { Area, AreaKind, Building, City, Column, Label, Rail, RoofShape, Street, StreetKind, Tree, Wall } from '../src/city/types.ts';
import { HISTORY } from './history/index.ts';
import { blockOutlines, loadMask, maskShare, type Mask } from './mask.ts';
import { Parts, frame } from './landmarks.ts';

const id = process.argv[2] ?? 'potsdam';
const spec = CITIES[id];
if (!spec) throw new Error('unknown city ' + id);
const YEAR = spec.year;
const hist = HISTORY[id]!;
const { fwd } = projector(spec.origin[0], spec.origin[1]);
const osm = load(`data/${id}/osm.json`, fwd);
const ohm = load(`data/${id}/ohm.json`, fwd);
const [bx0, bz1] = fwd(spec.bbox[0], spec.bbox[1]), [bx1, bz0] = fwd(spec.bbox[2], spec.bbox[3]);
const mask: Mask | null = spec.map ? loadMask(`data/${id}/${spec.map.file}`, fwd(spec.bbox[2], spec.bbox[1]), fwd(spec.bbox[0], spec.bbox[3])) : null;
const inBounds = (p: Pt) => p[0] >= bx0 && p[0] <= bx1 && p[1] >= bz0 && p[1] <= bz1;

const flat = (pts: Pt[]): Ring => pts.flatMap((p) => [round(p[0]), round(p[1])]);
const round = (v: number) => Math.round(v * 100) / 100;
const num = (s: string | undefined) => {
  if (!s) return undefined;
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
};

/* ── Colours ──────────────────────────────────────────────────── */
const NAMED: Record<string, string> = {
  white: '#ece8de', beige: '#d9c9a3', yellow: '#dcc27a', lightyellow: '#e6d9a6', ivory: '#ece4cc', cream: '#e8dcb8',
  orange: '#d49a5a', red: '#a8503c', brown: '#7e5a44', pink: '#d8a9a0', rose: '#d6a29a', salmon: '#d89a84',
  grey: '#a9a49b', gray: '#a9a49b', lightgrey: '#c9c4ba', lightgray: '#c9c4ba', darkgrey: '#6f6b66', darkgray: '#6f6b66',
  green: '#8a9c7a', lightgreen: '#b5c4a0', blue: '#8fa2b4', lightblue: '#b3c3cf', black: '#38363a', sand: '#d4c09a',
  ochre: '#c9a25e', tan: '#c8ab84', silver: '#b8b8b4', olive: '#8c8a5c', maroon: '#7a3f34', terracotta: '#b0634a',
};
function colour(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const v = s.trim().toLowerCase().replace(/[\s_-]/g, '');
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join('');
  return NAMED[v];
}
// Plaster colours of baroque and classicist Potsdam: ochres, sand,
// pale yellow, rose and grey, picked per building by a hash of its id
// where the map gives none.
const PLASTER = ['#d9c39a', '#dcc589', '#e3d4ae', '#cfb48a', '#d8b9a0', '#cdbfa6', '#e2d3b9', '#c9a979', '#d4c4b0', '#bfae94', '#e0c8a2', '#d3b28e'];
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const ROOF_MAT: Record<string, string> = {
  roof_tiles: '#9b4f37', tile: '#9b4f37', tiles: '#9b4f37', clay: '#9b4f37', slate: '#4d5158', metal: '#7a8288',
  copper: '#5f8f7c', zinc: '#83898d', tar_paper: '#4a4a4a', concrete: '#8a8780', glass: '#9aaab4', thatch: '#8a7550',
};

/* ── Buildings ─────────────────────────────────────────────────── */
const SKIP_BUILDING = new Set(['garage', 'garages', 'carport', 'construction', 'container', 'allotment_house', 'cabin', 'kiosk',
  'roof', 'ruins', 'no', 'bunker', 'transformer_tower', 'toilets', 'greenhouse', 'tent', 'hut']);
const ROOFS: Record<string, RoofShape> = {
  flat: 'flat', gabled: 'gabled', hipped: 'hipped', mansard: 'mansard', gambrel: 'mansard', pyramidal: 'pyramidal',
  dome: 'dome', 'half-hipped': 'half-hipped', side_hipped: 'hipped', saltbox: 'gabled', double_saltbox: 'gabled',
  quadruple_saltbox: 'hipped', corner_saltbox: 'gabled', round: 'gabled', skillion: 'flat',
};

function toBuilding(f: Feature, src: 'osm' | 'ohm'): Building[] {
  const t = f.tags;
  const out: Building[] = [];
  const levels = num(t['building:levels']) ?? num(t.levels);
  const roofLevels = num(t['roof:levels']);
  const h = num(t.height), minH = num(t.min_height), minL = num(t['building:min_level']);
  const kind = buildingKind(t);
  const storey = kind === 'church' || kind === 'palace' ? 5 : 3.5;
  for (let k = 0; k < f.outer.length; k++) {
    let outer = simplify(flat(f.outer[k]!), 0.25);
    if (Math.abs(area(outer)) < 6) continue;
    outer = orient(outer, true);
    const holes = f.inner.map((r) => orient(simplify(flat(r), 0.25), false)).filter((r) => Math.abs(area(r)) > 4)
      .filter((r) => inside(outer, r[0]!, r[1]!));
    const shape = ROOFS[t['roof:shape'] ?? ''] ?? defaultRoof(t, kind);
    const ext = bbox(outer), depth = Math.min(ext[2] - ext[0], ext[3] - ext[1]);
    const lv = levels ?? defaultLevels(t, kind, Math.abs(area(outer)));
    let eave = h !== undefined ? h : lv * storey + 0.6;
    let roofH = num(t['roof:height']) ?? (roofLevels !== undefined ? roofLevels * 2.8 : 0);
    if (shape !== 'flat' && roofH === 0) roofH = Math.min(depth * 0.5, 9) * (shape === 'mansard' ? 0.9 : 0.95);
    if (shape === 'flat') roofH = 0;
    if (h !== undefined) eave = Math.max(2.5, h - roofH);
    const seed = hashStr(f.id);
    const b: Building = {
      id: f.id, src, outer,
      eave: round(eave), roofH: round(roofH), roof: shape, storey,
      colour: colour(t['building:colour']) ?? PLASTER[seed % PLASTER.length]!,
      roofColour: colour(t['roof:colour']) ?? ROOF_MAT[t['roof:material'] ?? ''] ?? (kind === 'church' || kind === 'palace' ? '#5a5e66' : '#9b4f37'),
    };
    if (holes.length) b.holes = holes;
    const base = minH ?? (minL !== undefined ? minL * storey : undefined);
    if (base) b.base = base;
    if (t.name) b.name = t.name;
    const addr = t['addr:street'] && t['addr:housenumber'] ? `${t['addr:street']} ${t['addr:housenumber']}` : undefined;
    if (addr) b.addr = addr;
    const y = year(t.start_date) ?? year(t.year_of_construction);
    if (y) b.year = y;
    if (kind) b.kind = kind;
    if (kind === 'shed' || kind === 'colonnade') b.windows = false;
    out.push(b);
  }
  return out;
}

function buildingKind(t: Tags): Building['kind'] {
  const b = t.building ?? '';
  if (b === 'church' || b === 'chapel' || b === 'cathedral' || t.amenity === 'place_of_worship') return 'church';
  if (b === 'palace' || b === 'castle' || t.historic === 'castle') return 'palace';
  if (t.historic === 'city_gate' || t.barrier === 'city_gate') return 'gate';
  if (b === 'shed' || b === 'stable' || b === 'barn' || b === 'service' || b === 'riding_hall' || b === 'industrial' || b === 'warehouse') return 'shed';
  if (b === 'roof') return 'colonnade';
  if (b === 'civic' || b === 'public' || b === 'government' || b === 'school' || b === 'train_station' || b === 'hospital') return 'public';
  return 'house';
}
function defaultLevels(t: Tags, kind: Building['kind'], a: number) {
  if (kind === 'shed') return 1;
  if (kind === 'church') return 3;
  if (kind === 'gate') return 2;
  if (t.building === 'house' || t.building === 'detached') return 2;
  return a < 40 ? 1 : a < 90 ? 2 : 3;
}
function defaultRoof(t: Tags, kind: Building['kind']): RoofShape {
  if (kind === 'gate') return 'flat';
  if (kind === 'palace' || kind === 'public') return 'hipped';
  return 'gabled';
}

/* ── Gather ───────────────────────────────────────────────────── */
const buildings: Building[] = [];
const ohmBuildings = ohm.feats.filter((f) => f.closed && f.tags.building && f.tags.building !== 'construction');
const ohmAlive = ohmBuildings.filter((f) => aliveIn(f.tags, YEAR));
// OHM footprints of buildings that came later than the year: an
// undated OSM building on that spot is that later building.
const ohmLater = ohmBuildings.filter((f) => (year(f.tags.start_date) ?? -Infinity) > YEAR);
const covers = (fs: Feature[], x: number, z: number) => fs.some((f) => f.outer.some((r) => inside(flat(r), x, z)));

const stats = { osmDated: 0, osmUndated: 0, osmDroppedLater: 0, osmDroppedOhm: 0, osmDroppedMask: 0, ohm: 0, mtb: 0 };
for (const f of osm.feats) {
  const t = f.tags;
  if (!f.closed || !t.building || t['building:part'] || SKIP_BUILDING.has(t.building)) continue;
  if (!f.outer[0] || !inBounds(f.outer[0][0]!)) continue;
  if (hist.drop.has(f.id)) continue;
  const y = year(t.start_date) ?? year(t.year_of_construction) ?? year(t.construction_date);
  if (y !== undefined && y > YEAR) { stats.osmDroppedLater++; continue; }
  const [cx, cz] = centroid(flat(f.outer[0]));
  if (covers(ohmAlive, cx, cz)) { stats.osmDroppedOhm++; continue; }   // OHM has the 1900 building here
  if (y === undefined) {
    if (covers(ohmLater, cx, cz)) { stats.osmDroppedLater++; continue; }
    // Undated: kept where the historical map has the ground built up,
    // and when it does not look like a building of after 1900 (five
    // storeys and up, or a flat roof over three) — the slabs of the
    // 1960s and 70s that went up on the bombed old town's blocks.
    const lv = num(t['building:levels']) ?? 0;
    const modern = lv >= 5 || (t['roof:shape'] === 'flat' && lv >= 3);
    if (mask && (modern || maskShare(mask, flat(f.outer[0])) < 0.5)) { stats.osmDroppedMask++; continue; }
    stats.osmUndated++;
  } else stats.osmDated++;
  buildings.push(...toBuilding(f, 'osm'));
}
for (const f of ohmAlive) {
  if (!f.outer[0] || !inBounds(f.outer[0][0]!)) continue;
  if (hist.drop.has('ohm:' + f.id)) continue;
  stats.ohm++;
  buildings.push(...toBuilding(f, 'ohm').map((b) => ({ ...b, id: 'ohm:' + b.id })));
}
for (const b of buildings) Object.assign(b, hist.patch[b.id] ?? {});

/* ── Landmarks ────────────────────────────────────────────────────
   Each replaces the mapped footprint under its `at` point (and every
   other footprint whose centre falls inside that one) with its parts. */
const columns: Column[] = [];
for (const lm of hist.landmarks) {
  const hits = buildings.filter((b) => inside(b.outer, lm.at[0], lm.at[1]));
  if (!hits.length) { console.warn('landmark without footprint:', lm.id); continue; }
  hits.sort((a, b) => Math.abs(area(b.outer)) - Math.abs(area(a.outer)));
  const ring = hits[0]!.outer;
  const gone = new Set(hits);
  for (const b of buildings) { const [x, z] = centroid(b.outer); if (inside(ring, x, z)) gone.add(b); }
  for (let i = buildings.length - 1; i >= 0; i--) if (gone.has(buildings[i]!)) buildings.splice(i, 1);
  const P = new Parts(lm.id, frame(ring, lm.front), lm.name, lm.year);
  lm.build(P, ring);
  buildings.push(...P.list);
  columns.push(...P.columns);
}

/* ── Areas ────────────────────────────────────────────────────── */
function areaKind(t: Tags): AreaKind | undefined {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'basin' || t.landuse === 'reservoir') return 'water';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green' || t.natural === 'grassland') return 'grass';
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cemetery';
  if (t.place === 'square' || t.highway === 'pedestrian' || t['area:highway']) return 'square';
  if (t.landuse === 'railway') return 'rail';
  return undefined;
}
const areas: Area[] = [];
function addAreas(fs: Feature[], hist1900: boolean) {
  for (const f of fs) {
    if (!f.closed) continue;
    if (hist1900 && !aliveIn(f.tags, YEAR)) continue;
    const k = areaKind(f.tags);
    if (!k) continue;
    for (const o of f.outer) {
      const r = flat(o);
      if (Math.abs(area(r)) < 4) continue;
      const a: Area = { kind: k, outer: orient(r, true) };
      const holes = f.inner.map((h) => orient(flat(h), false));
      if (holes.length) a.holes = holes;
      if (f.tags.name) a.name = f.tags.name;
      areas.push(a);
    }
  }
}
// Modern areas (water and green) first, then what OHM says of 1900 on top.
addAreas(osm.feats.filter((f) => areaKind(f.tags) === 'water'), false);
addAreas(ohm.feats, true);
for (const sq of hist.squares) areas.push({ kind: 'square', outer: orient(sq.ring, true), name: sq.name });
// Canals that OHM has only as a line: widened to water, lined with
// railings later (once the bridges are known).
const canals: { left: number[]; right: number[] }[] = [];
for (const f of ohm.feats) {
  if (f.tags.waterway !== 'canal' || !f.line || !aliveIn(f.tags, YEAR)) continue;
  const w = hist.canalWidth[f.tags.name ?? ''] ?? 8;
  const b = buffer(flat(f.line), w / 2);
  areas.push({ kind: 'water', outer: orient(b.ring, true), name: f.tags.name ?? 'Kanal' });
  canals.push(b);
}

/* ── Lost frontage, rebuilt from the historical map's blocks ──────
   Inside the closely built town every block of the map was lined
   with houses wall to wall. Each block's outline is walked edge by
   edge and cut into parcels of 10–16 m frontage and a house's depth;
   a parcel is built unless a kept building already stands on it, or
   it falls in water or in a square or park of the year. What gets
   built is a plain townhouse of its time and place — two or three
   storeys, the ridge along the street, a gable or mansard roof — not
   the house that stood there, which the map cannot tell. */
if (mask) {
  const grid = new Map<string, Building[]>();
  const G = 25;
  for (const b of buildings) {
    const [x0, z0, x1, z1] = bbox(b.outer);
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) {
      const k = i + ',' + j;
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(b);
    }
  }
  const built = (x: number, z: number) => (grid.get(Math.floor(x / G) + ',' + Math.floor(z / G)) ?? []).some((b) => inside(b.outer, x, z));
  const open = areas.filter((a) => a.kind !== 'water');
  const water = areas.filter((a) => a.kind === 'water');
  const inAny = (as: Area[], x: number, z: number) => as.some((a) => inside(a.outer, x, z) && !(a.holes ?? []).some((h) => inside(h, x, z)));
  let n = 0;
  for (const raw of blockOutlines(mask, 250)) {
    // The blur and the closing grow the map's blocks by a metre or
    // two past the building line; take the frontage that far in.
    const ring = inset(straighten(orient(simplify(raw, 1.5), true), 0.45, 2.5), 1.8);
    const box = obb(ring);
    const maxDepth = Math.min(12.5, box.b * 0.9);
    if (maxDepth < 5) continue;
    const m = ring.length / 2;
    for (let e = 0; e < m; e++) {
      const p = (e + m - 1) % m, q = (e + 1) % m;
      const ax = ring[2 * e]!, az = ring[2 * e + 1]!, bx2 = ring[2 * q]!, bz2 = ring[2 * q + 1]!;
      const px = ring[2 * p]!, pz = ring[2 * p + 1]!;
      const dx = bx2 - ax, dz = bz2 - az, L = Math.hypot(dx, dz);
      if (L < 6) continue;
      const ux = dx / L, uz = dz / L, ix = -uz, iz = ux;   // along, inward
      // A convex corner at the start belongs to the previous edge's last
      // parcel, which runs to its end and a house deep: start past it.
      const pl = Math.hypot(ax - px, az - pz) || 1;
      const sinTurn = ((ax - px) * dz - (az - pz) * dx) / (pl * L);
      const s0 = sinTurn > 0.7 ? Math.min(maxDepth, L * 0.5) : 0;
      const len = L - s0;
      if (len < 5) continue;
      const seed = hashStr(`${Math.round(ax)},${Math.round(az)}`);
      const target = 10 + (seed % 7);
      const k = Math.max(1, Math.round(len / target));
      for (let i = 0; i < k; i++) {
        const t0 = s0 + (len * i) / k, t1 = s0 + (len * (i + 1)) / k;
        const ps = hashStr(`${e}:${i}:${seed}`);
        const depth = maxDepth * (0.85 + 0.15 * ((ps >>> 3) % 7) / 6);
        const f0x = ax + ux * t0, f0z = az + uz * t0, f1x = ax + ux * t1, f1z = az + uz * t1;
        // samples a step inside the frontage: any one built, water or open means no house
        let skip = !inside(hist.town, (f0x + f1x) / 2 + ix * depth / 2, (f0z + f1z) / 2 + iz * depth / 2);
        for (const f of [0.15, 0.5, 0.85]) for (const d of [1.5, 4, depth * 0.85]) {
          const sx = f0x + (f1x - f0x) * f + ix * d, sz = f0z + (f1z - f0z) * f + iz * d;
          if (built(sx, sz) || inAny(water, sx, sz) || inAny(open, sx, sz) || !mask.at(sx, sz)) skip = true;
        }
        if (skip) continue;
        const outer = orient([f0x, f0z, f1x, f1z, f1x + ix * depth, f1z + iz * depth, f0x + ix * depth, f0z + iz * depth].map(round), true);
        if (Math.abs(area(outer)) < 20) continue;
        const levels = ps % 5 < 3 ? 3 : 2;
        const storey = 3.3 + (ps % 3) * 0.1;
        const roof: RoofShape = ps % 10 < 3 ? 'mansard' : 'gabled';
        buildings.push({
          id: `mtb${n++}`, src: 'mtb', outer,
          eave: round(levels * storey + 0.6), roofH: round(depth * (roof === 'mansard' ? 0.42 : 0.48)), roof,
          ridge: Math.atan2(uz, ux), storey,
          colour: PLASTER[(ps >>> 5) % PLASTER.length]!, roofColour: (ps >>> 9) % 6 === 0 ? '#555a60' : '#9b4f37',
        });
        stats.mtb++;
      }
    }
  }
}

/* ── Streets ──────────────────────────────────────────────────── */
const WIDTH: Record<string, [StreetKind, number]> = {
  primary: ['main', 18], secondary: ['main', 16], tertiary: ['street', 14], residential: ['street', 13], unclassified: ['street', 11],
  living_street: ['street', 10], pedestrian: ['street', 12], service: ['lane', 6], footway: ['path', 3], path: ['path', 2.5],
  cycleway: ['path', 2.5], track: ['lane', 4], steps: ['path', 3],
};
const streets: Street[] = [];
function addStreets(fs: Feature[], hist1900: boolean) {
  for (const f of fs) {
    const t = f.tags;
    if (!t.highway || !f.line || (f.closed && t.area === 'yes')) continue;
    if (hist1900 && !aliveIn(t, YEAR)) continue;
    const w = WIDTH[t.highway];
    if (!w) continue;
    const bridge = t.bridge && t.bridge !== 'no';
    const kind: StreetKind = bridge ? (w[0] === 'path' ? 'footbridge' : 'bridge') : w[0];
    const s: Street = {
      kind, w: num(t.width) ?? w[1], pts: flat(f.line),
      paving: w[0] === 'path' ? 'gravel' : w[0] === 'lane' ? 'earth' : 'cobble',
    };
    if (t.name) s.name = t.name;
    streets.push(s);
  }
}
addStreets(ohm.feats, true);
const ohmBridges = streets.filter((s) => s.kind === 'bridge' || s.kind === 'footbridge');
const nOhm = streets.length;
addStreets(osm.feats, false);
/* Today's streets are the town's streets of 1900 except where the
   post-war town cut new roads through old blocks or over new bridges:
   a street running mostly over the 1903 map's built blocks is one of
   those, and so is a bridge with no bridge of the year near it. */
const streetStats = { dropped: 0, bridgesDropped: 0, bridgesAdded: 0, renamed: 0 };
/* Names of the year: an OSM street takes the name of an OHM street of
   1900 that runs along it (most of its length within 12 m), else a
   rename from the history file, else today's name. */
const ohmNamed = streets.slice(0, nOhm).filter((o) => o.name);
for (let i = nOhm; i < streets.length; i++) {
  const st = streets[i]!;
  let best = '', bestShare = 0.6;
  for (const o of ohmNamed) {
    let n = 0, k = 0;
    const p = st.pts;
    for (let j = 0; j < p.length; j += 2) { n++; if (nearLine(o.pts, p[j]!, p[j + 1]!, 12)) k++; }
    if (n && k / n > bestShare) { bestShare = k / n; best = o.name!; }
  }
  const before = st.name;
  if (best) st.name = best;
  else if (st.name && hist.rename[st.name]) st.name = hist.rename[st.name];
  if (st.name !== before) streetStats.renamed++;
}
for (let i = streets.length - 1; i >= nOhm; i--) {
  const st = streets[i]!;
  if (st.kind === 'bridge' || st.kind === 'footbridge') {
    const [mx, mz] = midpoint(st.pts);
    if (!ohmBridges.some((o) => nearLine(o.pts, mx, mz, 25))) { streets.splice(i, 1); streetStats.bridgesDropped++; }
    continue;
  }
  if (mask && st.kind !== 'path' && builtShare(st.pts) > 0.45) { streets.splice(i, 1); streetStats.dropped++; }
}
function midpoint(p: number[]): [number, number] {
  let L = 0;
  for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
  let acc = 0;
  for (let i = 2; i < p.length; i += 2) {
    const l = Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
    if (acc + l >= L / 2) { const t = (L / 2 - acc) / (l || 1); return [p[i - 2]! + (p[i]! - p[i - 2]!) * t, p[i - 1]! + (p[i + 1]! - p[i - 1]!) * t]; }
    acc += l;
  }
  return [p[0]!, p[1]!];
}
function builtShare(p: number[]) {
  let n = 0, k = 0;
  for (let i = 2; i < p.length; i += 2) {
    const L = Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!), m = Math.max(1, Math.ceil(L / 3));
    for (let j = 0; j < m; j++) {
      const x = p[i - 2]! + (p[i]! - p[i - 2]!) * (j + 0.5) / m, z = p[i - 1]! + (p[i + 1]! - p[i - 1]!) * (j + 0.5) / m;
      n++; if (mask!.at(x, z)) k++;
    }
  }
  return n ? k / n : 0;
}

/* ── Walls, rails, trees ─────────────────────────────────────── */
const walls: Wall[] = [];
for (const f of ohm.feats) {
  if (!f.line || !aliveIn(f.tags, YEAR)) continue;
  if (f.tags.barrier === 'city_wall') walls.push({ pts: flat(f.line), h: 4.2, t: 0.8, kind: 'city' });
  else if (f.tags.barrier === 'wall') walls.push({ pts: flat(f.line), h: 2.4, t: 0.5, kind: 'garden' });
}
// Every street that crosses a canal does so on a bridge: where no
// bridge of the year is mapped at a crossing, one is laid there.
for (const c of canals) {
  const mid: number[] = [];
  for (let i = 0; i < c.left.length; i += 2) mid.push((c.left[i]! + c.right[i]!) / 2, (c.left[i + 1]! + c.right[i + 1]!) / 2);
  const cw = Math.hypot(c.left[0]! - c.right[0]!, c.left[1]! - c.right[1]!);
  for (const st of streets.slice()) {
    if (st.kind === 'bridge' || st.kind === 'footbridge') continue;
    const p = st.pts;
    for (let i = 2; i < p.length; i += 2) for (let j = 2; j < mid.length; j += 2) {
      const hit = cross(p[i - 2]!, p[i - 1]!, p[i]!, p[i + 1]!, mid[j - 2]!, mid[j - 1]!, mid[j]!, mid[j + 1]!);
      if (!hit) continue;
      if (ohmBridges.some((o) => nearLine(o.pts, hit[0], hit[1], 15))) continue;
      const dx = p[i]! - p[i - 2]!, dz = p[i + 1]! - p[i - 1]!, L = Math.hypot(dx, dz) || 1, h = cw / 2 + 2.5;
      streets.push({ kind: st.kind === 'path' ? 'footbridge' : 'bridge', w: Math.min(st.w, 12), name: st.name ?? 'Brücke',
        pts: [hit[0] - dx / L * h, hit[1] - dz / L * h, hit[0] + dx / L * h, hit[1] + dz / L * h].map(round), paving: st.paving } as Street);
      streetStats.bridgesAdded++;
    }
  }
}
function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): [number, number] | null {
  const r = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(r) < 1e-9) return null;
  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / r, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / r;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [ax + (bx - ax) * t, az + (bz - az) * t] : null;
}
// Railings along the canals, broken where a street crosses on a bridge.
for (const c of canals) {
  for (const side of [c.left, c.right]) {
    let run: number[] = [];
    const flush = () => { if (run.length >= 4) walls.push({ pts: run.map(round), h: 1.05, t: 0.08, kind: 'railing' }); run = []; };
    // walk the side in steps of about 2 m so breaks fall close to the bridge
    for (let i = 2; i < side.length; i += 2) {
      const ax = side[i - 2]!, az = side[i - 1]!, bx = side[i]!, bz = side[i + 1]!;
      const L = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.ceil(L / 2));
      for (let j = 0; j <= k; j++) {
        if (j === 0 && run.length) continue;
        const x = ax + (bx - ax) * j / k, z = az + (bz - az) * j / k;
        const onBridge = streets.some((s) => (s.kind === 'bridge' || s.kind === 'footbridge') && nearLine(s.pts, x, z, s.w / 2 + 0.5));
        if (onBridge) flush(); else run.push(x, z);
      }
    }
    flush();
  }
}
function nearLine(p: number[], x: number, z: number, d: number) {
  for (let i = 2; i < p.length; i += 2) if (segDist2(x, z, p[i - 2]!, p[i - 1]!, p[i]!, p[i + 1]!) < d * d) return true;
  return false;
}
const rails: Rail[] = [];
for (const f of ohm.feats) {
  const r = f.tags.railway;
  if (!f.line || !r || !aliveIn(f.tags, YEAR)) continue;
  if (r === 'rail' || r === 'light_rail') rails.push({ pts: flat(f.line), kind: 'rail' });
  else if (r === 'tram') rails.push({ pts: flat(f.line), kind: 'tram' });
}
const trees: Tree[] = [];
for (const p of osm.points) {
  if (p.tags.natural !== 'tree' || !inBounds(p.p)) continue;
  const seed = hashStr(p.id);
  trees.push({ x: round(p.p[0]), z: round(p.p[1]), h: 9 + (seed % 9), r: 2.8 + (seed % 5) * 0.5 });
}

/* ── Labels ───────────────────────────────────────────────────── */
const labels: Label[] = [];
for (const b of buildings) {
  if (!b.name || b.src === 'mtb') continue;
  const [x, z] = centroid(b.outer);
  labels.push({ x: round(x), z: round(z), text: b.name, kind: 'landmark' });
}

/* ── Check ─────────────────────────────────────────────────────── */
for (const b of buildings) {
  const bad = !/^#[0-9a-f]{6}$/.test(b.colour) || !/^#[0-9a-f]{6}$/.test(b.roofColour) || !(b.eave > 0) || b.outer.length < 6 || b.outer.some((v) => !Number.isFinite(v));
  if (bad) throw new Error('bad building ' + JSON.stringify(b));
}

/* ── Clip to bounds and write ─────────────────────────────────── */
const keepRing = (r: Ring) => { for (let i = 0; i < r.length; i += 2) if (inBounds([r[i]!, r[i + 1]!])) return true; return false; };
const city: City = {
  id, name: hist.name, year: YEAR, origin: spec.origin,
  bounds: [round(bx0), round(bz0), round(bx1), round(bz1)],
  spawn: hist.spawn,
  buildings,
  areas: areas.filter((a) => keepRing(a.outer) || a.kind === 'water'),
  streets: streets.filter((s) => keepRing(s.pts)),
  walls: walls.filter((w) => keepRing(w.pts)),
  rails: rails.filter((r) => keepRing(r.pts)),
  trees, columns, labels,
  water: hist.water,
  credits: hist.credits,
};
mkdirSync(`src/cities/${id}`, { recursive: true });
writeFileSync(`src/cities/${id}/city.json`, JSON.stringify(city));
console.log(stats, streetStats, { buildings: buildings.length, areas: city.areas.length, streets: city.streets.length, walls: city.walls.length, rails: city.rails.length, trees: trees.length });
