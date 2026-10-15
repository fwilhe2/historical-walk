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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CITIES } from './cities.ts';
import { aliveIn, load, projector, year, type Feature, type Pt, type Tags } from './osm.ts';
import { area, bbox, buffer, centroid, inside, inset, obb, orient, segDist2, simplify, straighten, type Ring } from '../src/geom/poly.ts';
import type { Area, AreaKind, Building, City, Column, Label, Lamp, Rail, RoofShape, Street, StreetKind, Tree, Wall } from '../src/city/types.ts';
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
  orange: '#d49a5a', red: '#9c5038', brown: '#7e5a44', pink: '#d8a9a0', rose: '#d6a29a', salmon: '#d89a84',
  grey: '#a9a49b', gray: '#a9a49b', lightgrey: '#c9c4ba', lightgray: '#c9c4ba', darkgrey: '#6f6b66', darkgray: '#6f6b66',
  green: '#8a9c7a', lightgreen: '#b5c4a0', blue: '#8fa2b4', lightblue: '#b3c3cf', black: '#38363a', sand: '#d4c09a',
  ochre: '#c9a25e', tan: '#c8ab84', silver: '#b8b8b4', olive: '#8c8a5c', maroon: '#7a3f34', terracotta: '#b0634a',
};
function colour(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const v = s.split(';')[0]!.trim().toLowerCase().replace(/[\s_-]/g, '');
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
    // a pitched roof's height from its depth; roof:levels (a storey in
    // the roof) only ever raises it — 2.8 m a level alone made the Dutch
    // Quarter's steep roofs into low lids
    if (shape !== 'flat' && num(t['roof:height']) === undefined) roofH = Math.max(roofH, Math.min(depth * 0.5, 9) * (shape === 'mansard' ? 0.9 : 0.95));
    if (shape === 'flat') roofH = 0;
    if (h !== undefined) eave = Math.max(2.5, h - roofH);
    const seed = hashStr(f.id);
    const mat = (t['building:material'] ?? '').split(';')[0]!.trim();
    const wall: Building['wall'] = mat === 'brick' || mat === 'bricks' ? 'brick' : mat === 'sandstone' || mat === 'stone' ? 'stone' : undefined;
    const b: Building = {
      id: f.id, src, outer,
      eave: round(eave), roofH: round(roofH), roof: shape, storey,
      // brick of the Dutch Quarter: a red that has weathered to brown-orange
      colour: colour(t['building:colour']) ?? (wall === 'brick' ? '#9c5038' : PLASTER[seed % PLASTER.length]!),
      roofColour: colour(t['roof:colour']) ?? ROOF_MAT[t['roof:material'] ?? ''] ?? (kind === 'church' || kind === 'palace' ? '#5a5e66' : '#9b4f37'),
    };
    if (holes.length) b.holes = holes;
    if (wall) b.wall = wall;
    const arch = t['building:architecture'] ?? '';
    if (/baroque|classicism|neoclassicism|renaissance/.test(arch) && lv >= 2 && wall !== 'brick') b.ornate = true;
    const base = minH ?? (minL !== undefined ? minL * storey : undefined);
    if (base) b.base = base;
    if (t.name) b.name = t.name;
    const addr = t['addr:street'] && t['addr:housenumber'] ? `${t['addr:street']} ${t['addr:housenumber']}` : undefined;
    if (addr) b.addr = addr;
    const y = year(t.start_date) ?? year(t.year_of_construction);
    if (y) b.year = y;
    // A flat roof on a house built before 1880 is today's roof or a
    // mapping shortcut: the town's baroque and classicist houses had
    // pitched roofs. Such a house gets a hipped roof of its depth; so
    // does an undated one of two storeys or more (kept by the 1903 map,
    // so standing on a block of the year). Yard sheds stay flat.
    if (shape === 'flat' && depth > 4 && ((y !== undefined && y < 1880) || (y === undefined && eave > 6))) {
      b.roof = 'hipped'; b.roofH = round(Math.min(depth * 0.45, 8));
    }
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

const stats = { osmDated: 0, osmUndated: 0, osmDroppedLater: 0, osmDroppedOhm: 0, osmDroppedMask: 0, osmDroppedLost: 0, ohm: 0, mtb: 0, mtbAlone: 0 };
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
    if (hist.lost.some((z) => inside(z.ring, cx, cz))) { stats.osmDroppedLost++; continue; }
    if (t['addr:street'] && hist.newStreets.includes(t['addr:street'])) { stats.osmDroppedLater++; continue; }
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
const abouts = new Map<string, string>();
for (const lm of hist.landmarks) {
  const hits = buildings.filter((b) => inside(b.outer, lm.at[0], lm.at[1]));
  if (!hits.length) { console.warn('landmark without footprint:', lm.id); continue; }
  hits.sort((a, b) => Math.abs(area(b.outer)) - Math.abs(area(a.outer)));
  const ring = hits[0]!.outer;
  if (!lm.keep) {
    const gone = new Set(hits);
    for (const b of buildings) { const [x, z] = centroid(b.outer); if (inside(ring, x, z)) gone.add(b); }
    for (let i = buildings.length - 1; i >= 0; i--) if (gone.has(buildings[i]!)) buildings.splice(i, 1);
  }
  const P = new Parts(lm.id, frame(ring, lm.front), lm.name, lm.year);
  lm.build(P, ring);
  if (lm.about) abouts.set(lm.name, lm.about);
  buildings.push(...P.list);
  columns.push(...P.columns);
}

/* ── Colonnades ───────────────────────────────────────────────────
   OHM maps colonnades (building=roof) as thin strips — the
   Ringerkolonnade and the Havelkolonnade of 1745–46 are 1.3 m wide.
   Each becomes a row of columns along its axis, 2.6 m apart, under an
   entablature: open to walk through, as they were. Heights estimated. */
for (let i = buildings.length - 1; i >= 0; i--) {
  const b = buildings[i]!;
  if (b.kind !== 'colonnade') continue;
  const o = obb(b.outer);
  const c = Math.cos(o.ang), sn = Math.sin(o.ang);
  const n = Math.max(2, Math.round((2 * o.a) / 2.6) + 1);
  const H = 6.2;
  for (let k = 0; k < n; k++) {
    const u = -o.a + 0.5 + (2 * o.a - 1) * k / (n - 1);
    columns.push({ x: round(o.cx + u * c), z: round(o.cz + u * sn), r: 0.32, h: H, base: 0 });
  }
  buildings[i] = { ...b, base: H, eave: H + 1.3, roof: 'flat', roofH: 0, windows: false, wall: 'stone', colour: '#e2d6bf' };
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
for (const sq of hist.squares) areas.push({ kind: sq.kind ?? 'square', outer: orient(sq.ring, true), name: sq.name });
// The 1903 map's built blocks inside the town: what is not building in them is yard,
// packed earth and paving; everything else unbuilt is garden (the
// ground's default). Yards go first, so parks and squares paint over.
if (mask) {
  const yards: Area[] = [];
  for (const raw of blockOutlines(mask, 150)) {
    const ring = orient(simplify(raw, 1.5), true).map(round);
    // only in the closely built town: outside it the hatched blocks are
    // villas in their gardens, most of whose houses are not drawn
    // (a block straddling the town's line counts if most of it is inside)
    const [x0, z0, x1, z1] = bbox(ring);
    let n = 0, k = 0;
    const st = Math.max(4, Math.min(x1 - x0, z1 - z0) / 8);
    for (let x = x0 + st / 2; x < x1; x += st) for (let z = z0 + st / 2; z < z1; z += st) {
      if (!inside(ring, x, z)) continue;
      n++; if (inside(hist.town, x, z)) k++;
    }
    if (n && k / n > 0.85) yards.push({ kind: 'yard', outer: ring });
  }
  areas.unshift(...yards);
}
// An undated building standing in a park or square of the year came later.
{
  const open = areas.filter((a) => a.kind !== 'water' && a.kind !== 'rail' && a.kind !== 'yard');
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i]!;
    if (b.src !== 'osm' || b.year !== undefined) continue;
    const [x, z] = centroid(b.outer);
    if (open.some((a) => inside(a.outer, x, z) && !(a.holes ?? []).some((h) => inside(h, x, z)))) { buildings.splice(i, 1); stats.osmDroppedMask++; }
  }
}
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
const streetStats = { dropped: 0, paths: 0, bridgesDropped: 0, bridgesAdded: 0, renamed: 0 };
const greens = areas.filter((a) => a.kind === 'park' || a.kind === 'garden' || a.kind === 'cemetery' || a.kind === 'grass');
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
  if (mask && st.kind !== 'path' && builtShare(st.pts) > 0.45) { streets.splice(i, 1); streetStats.dropped++; continue; }
  // Today's footpaths are today's: pavements mapped as their own
  // lines, station forecourts, the island's promenades. Only paths in
  // a park, garden or cemetery of the year are kept.
  if (st.kind === 'path') {
    const [mx, mz] = midpoint(st.pts);
    if (!greens.some((a) => inside(a.outer, mx, mz))) { streets.splice(i, 1); streetStats.paths++; }
  }
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
  // carriageways of the year, binned like the buildings: no house in a street
  const sgrid = new Map<string, Street[]>();
  for (const st of streets) {
    if (st.kind === 'path' || st.kind === 'footbridge') continue;
    const [x0, z0, x1, z1] = bbox(st.pts);
    for (let i = Math.floor((x0 - 10) / G); i <= Math.floor((x1 + 10) / G); i++) for (let j = Math.floor((z0 - 10) / G); j <= Math.floor((z1 + 10) / G); j++) {
      const k = i + ',' + j; let l = sgrid.get(k); if (!l) sgrid.set(k, (l = [])); l.push(st);
    }
  }
  const fronts = (x: number, z: number) => (sgrid.get(Math.floor(x / G) + ',' + Math.floor(z / G)) ?? []).some((st) => nearLine(st.pts, x, z, st.w / 2 + 5))
    || inAny(open.filter((a) => a.kind === 'square'), x, z);
  const inStreet = (x: number, z: number) => (sgrid.get(Math.floor(x / G) + ',' + Math.floor(z / G)) ?? []).some((st) => nearLine(st.pts, x, z, Math.max(2.5, st.w / 2 - 2.6)));
  const open = areas.filter((a) => a.kind !== 'water' && a.kind !== 'yard');
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
        // a row house fronts a street or a square: something of the year's
        // street network must lie just before its front, else this is the
        // map's hatching round a yard or a garden, not a frontage
        const mx = (f0x + f1x) / 2 - ix * 4, mz = (f0z + f1z) / 2 - iz * 4;
        const fx = (f0x + f1x) / 2 - ix * 9, fz = (f0z + f1z) / 2 - iz * 9;
        // (where the year's streets are not mapped — the lost old town —
        // the map's own open ground before the front is the street)
        const openGround = !mask.at(mx, mz) && !mask.at(fx, fz) && !inAny(water, mx, mz) && !inAny(open.filter((a) => a.kind !== 'square'), mx, mz);
        if (!fronts(mx, mz) && !openGround) skip = true;
        for (const f of [0.15, 0.5, 0.85]) for (const d of [1.5, 4, depth * 0.85]) {
          const sx = f0x + (f1x - f0x) * f + ix * d, sz = f0z + (f1z - f0z) * f + iz * d;
          if (built(sx, sz) || inStreet(sx, sz) || inAny(water, sx, sz) || inAny(open, sx, sz) || !mask.at(sx, sz)) skip = true;
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
  /* A rebuilt house stands in a row: one with no other building within
     1.5 m of either end of its frontage is the map's tree symbols or
     dots read as a block, not a street front, and goes. */
  const near = (x: number, z: number, self: Building) => buildings.some((b) => b !== self && (inside(b.outer, x, z) || ringDist(b.outer, x, z) < 1.5));
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i]!;
    if (b.src !== 'mtb') continue;
    const o = b.outer;   // f0, f1, back1, back0
    const ends: [number, number][] = [[o[0]!, o[1]!], [o[2]!, o[3]!], [o[4]!, o[5]!], [o[6]!, o[7]!]];
    if (!ends.some(([x, z]) => near(x, z, b))) { buildings.splice(i, 1); stats.mtb--; stats.mtbAlone++; }
  }
}
function ringDist(r: number[], x: number, z: number) {
  let m = Infinity;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) m = Math.min(m, segDist2(x, z, r[j]!, r[j + 1]!, r[i]!, r[i + 1]!));
  return Math.sqrt(m);
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
// Parapets on every bridge, along both edges where the bridge is
// over water: sandstone, a metre high, carried down past the deck
// so the bridge's side shows from the bank.
{
  const water = areas.filter((a) => a.kind === 'water');
  const wet = (x: number, z: number) => water.some((a) => inside(a.outer, x, z) && !(a.holes ?? []).some((h) => inside(h, x, z)));
  const bridges = streets.filter((st) => st.kind === 'bridge' || st.kind === 'footbridge');
  for (const st of bridges) {
    const b = buffer(st.pts, st.w / 2);
    // an edge inside or against another bridge's deck is not an edge
    // (OSM maps a wide bridge as carriageway and footways side by side)
    const others = bridges.filter((o) => o !== st);
    const deckBeyond = (x: number, z: number) => others.some((o) => nearLine(o.pts, x, z, o.w / 2 + 0.8));
    for (const side of [b.left, b.right]) {
      let run: number[] = [];
      const flush = () => { if (run.length >= 4) walls.push({ pts: run.map(round), h: 1.0, t: 0.45, kind: 'parapet', base: -1.4 }); run = []; };
      for (let i = 2; i < side.length; i += 2) {
        const ax = side[i - 2]!, az = side[i - 1]!, bx = side[i]!, bz = side[i + 1]!;
        const L = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.ceil(L));
        for (let j = 0; j <= k; j++) {
          if (j === 0 && run.length) continue;
          const x = ax + (bx - ax) * j / k, z = az + (bz - az) * j / k;
          // within 1.5 m of water along the edge, so the parapet runs onto the quay
          if (deckBeyond(x, z)) { flush(); continue; }
          if (wet(x, z) || wet(x + (bx - ax) / L * 1.5, z + (bz - az) / L * 1.5) || wet(x - (bx - ax) / L * 1.5, z - (bz - az) / L * 1.5)) run.push(x, z);
          else flush();
        }
      }
      flush();
    }
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
// Today's trees, except those standing on a carriageway of the year
// (the pedestrian zones' plantings) or on a building of the year.
const carriageways = streets.filter((st) => st.kind === 'main' || st.kind === 'street' || st.kind === 'bridge');
const trees: Tree[] = [];
for (const p of osm.points) {
  if (p.tags.natural !== 'tree' || !inBounds(p.p)) continue;
  if (carriageways.some((st) => nearLine(st.pts, p.p[0], p.p[1], st.w / 2 - 2.6))) continue;
  if (buildings.some((b) => inside(b.outer, p.p[0], p.p[1]))) continue;
  const seed = hashStr(p.id);
  trees.push({ x: round(p.p[0]), z: round(p.p[1]), h: 9 + (seed % 9), r: 2.8 + (seed % 5) * 0.5 });
}

/* Tram lines come in segments; join those that meet end to end
   (within 3 m) into routes, so a car can run a whole line. */
{
  const trams = rails.filter((r) => r.kind === 'tram').map((r) => r.pts.slice());
  const others = rails.filter((r) => r.kind !== 'tram');
  const near = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz) < 3;
  const routes: number[][] = [];
  while (trams.length) {
    let cur = trams.pop()!;
    for (let grown = true; grown;) {
      grown = false;
      for (let i = 0; i < trams.length; i++) {
        const t = trams[i]!, n = cur.length, m = t.length;
        const rev = (r: number[]) => { const o: number[] = []; for (let k = r.length - 2; k >= 0; k -= 2) o.push(r[k]!, r[k + 1]!); return o; };
        if (near(cur[n - 2]!, cur[n - 1]!, t[0]!, t[1]!)) cur = cur.concat(t.slice(2));
        else if (near(cur[n - 2]!, cur[n - 1]!, t[m - 2]!, t[m - 1]!)) cur = cur.concat(rev(t).slice(2));
        else if (near(cur[0]!, cur[1]!, t[m - 2]!, t[m - 1]!)) cur = t.slice(0, -2).concat(cur);
        else if (near(cur[0]!, cur[1]!, t[0]!, t[1]!)) cur = rev(t).slice(0, -2).concat(cur);
        else continue;
        trams.splice(i, 1); grown = true; break;
      }
    }
    routes.push(cur);
  }
  rails.length = 0;
  rails.push(...others, ...routes.map((pts) => ({ pts, kind: 'tram' as const })));
}

/* ── Shops ─────────────────────────────────────────────────────────
   A house on one of the shopping streets — its outline within 3 m of
   the street's carriageway edge — gets shopfronts below. Not the
   landmarks, the churches or the lost palaces. */
{
  const shopping = streets.filter((st) => (st.kind === 'main' || st.kind === 'street') && hist.shopStreets.includes(st.name ?? ''));
  for (const st of shopping) st.busy = true;
  let n = 0;
  for (const b of buildings) {
    if (b.kind && b.kind !== 'house') continue;
    if (b.src === 'model' || b.wall === 'brick') continue;
    const r = b.outer;
    let hit = false;
    for (let i = 0; i < r.length && !hit; i += 2) hit = shopping.some((st) => nearLine(st.pts, r[i]!, r[i + 1]!, st.w / 2 + 3));
    if (hit) { b.shop = true; n++; }
  }
  console.log('shops:', n);
}

/* ── Gas lanterns ─────────────────────────────────────────────────
   Potsdam's streets were lit by gas in 1900. A lantern every 32 m
   along each street, alternating sides, at the kerb (a metre inside
   the pavement's outer edge is the house front; the kerb is where the
   carriageway meets the pavement). None in water, on bridges, or
   inside a building. */
const lamps: Lamp[] = [];
{
  const G = 25, grid = new Map<string, Building[]>();
  for (const b of buildings) {
    const [x0, z0, x1, z1] = bbox(b.outer);
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) {
      const k = i + ',' + j; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(b);
    }
  }
  const builtAt = (x: number, z: number) => (grid.get(Math.floor(x / G) + ',' + Math.floor(z / G)) ?? []).some((b) => inside(b.outer, x, z));
  const water = areas.filter((a) => a.kind === 'water');
  const taken: [number, number][] = [];
  for (const st of streets) {
    if (st.kind !== 'main' && st.kind !== 'street') continue;
    if (!st.pts.some((_, i) => i % 2 === 0 && inside(hist.town, st.pts[i]!, st.pts[i + 1]!))) continue;
    const off = st.w / 2 - 2.0;
    let acc = 16, side = (hashStr(st.pts.slice(0, 2).join()) & 1) ? 1 : -1;
    for (let i = 2; i < st.pts.length; i += 2) {
      const ax = st.pts[i - 2]!, az = st.pts[i - 1]!, bx = st.pts[i]!, bz = st.pts[i + 1]!;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      while (acc < L) {
        const x = ax + ux * acc - uz * off * side, z = az + uz * acc + ux * off * side;
        const ok = !builtAt(x, z) && !water.some((a) => inside(a.outer, x, z)) && taken.every(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 > 14 * 14);
        if (ok) { lamps.push({ x: round(x), z: round(z) }); taken.push([x, z]); }
        acc += 32; side = -side;
      }
      acc -= L;
    }
  }
}

/* ── Labels ───────────────────────────────────────────────────── */
const labels: Label[] = [];
// Names of the year only: OHM's and the landmarks'. OSM's names are
// today's (ministries, galleries, shops) and stay off the labels.
for (const b of buildings) {
  // (and today's name of a building of the year that the history file describes)
  if (!b.name || (b.src !== 'ohm' && b.src !== 'model' && !hist.about[b.name])) continue;
  const [x, z] = centroid(b.outer);
  const o = obb(b.outer);
  const l: Label = { x: round(x), z: round(z), text: b.name, kind: 'landmark', r: round(Math.hypot(o.a, o.b)) };
  const about = abouts.get(b.name) ?? hist.about[b.name];
  if (about) l.about = about;
  labels.push(l);
}

/* ── Check ─────────────────────────────────────────────────────── */
for (const b of buildings) {
  const bad = !/^#[0-9a-f]{6}$/.test(b.colour) || !/^#[0-9a-f]{6}$/.test(b.roofColour) || !(b.eave > 0) || b.outer.length < 6 || b.outer.some((v) => !Number.isFinite(v));
  if (bad) throw new Error('bad building ' + JSON.stringify(b));
}

/* ── The land round the town ──────────────────────────────────────
   Water, woods and the royal parks of today in a wider box, simplified
   to 4 m. Only what lies at least partly outside the town's bounds
   matters (inside, the detailed plan is drawn). Today's woods stand
   for the woods of the year; parks only by name (history file). */
const region: Area[] = [];
let regionBounds: [number, number, number, number] = [bx0, bz0, bx1, bz1];
if (spec.region && existsSync(`data/${id}/region.json`)) {
  const raw = JSON.parse(readFileSync(`data/${id}/region.json`, 'utf8')) as { kind: string; name?: string; outer: number[][]; inner: number[][] }[];
  const proj = (r: number[]) => { const o: number[] = []; for (let i = 0; i < r.length; i += 2) { const [x, z] = fwd(r[i]!, r[i + 1]!); o.push(round(x), round(z)); } return o.slice(0, -2); };
  const outside = (r: number[]) => { for (let i = 0; i < r.length; i += 2) if (!inBounds([r[i]!, r[i + 1]!])) return true; return false; };
  for (const f of raw) {
    if (f.kind === 'park' && !hist.regionParks.includes(f.name ?? '')) continue;
    for (const o of f.outer) {
      const ring = orient(simplify(proj(o), 4), true);
      if (ring.length < 6 || Math.abs(area(ring)) < 400 || !outside(ring)) continue;
      const a: Area = { kind: f.kind === 'park' ? 'park' : f.kind === 'water' ? 'water' : 'wood', outer: ring };
      const holes = f.inner.map((h) => orient(simplify(proj(h), 4), false)).filter((h) => h.length >= 6 && inside(ring, h[0]!, h[1]!));
      if (holes.length) a.holes = holes;
      if (f.name) a.name = f.name;
      region.push(a);
    }
  }
  const [s0, w0] = fwd(spec.region[2], spec.region[1]), [s1, w1] = fwd(spec.region[0], spec.region[3]);
  regionBounds = [round(s0), round(w0), round(s1), round(w1)];
  // parks first, then woods, then water: the order they are painted in
  const order = { park: 0, wood: 1, water: 2 } as Record<string, number>;
  region.sort((a, b) => (order[a.kind] ?? 0) - (order[b.kind] ?? 0));
}

/* ── Terrain ──────────────────────────────────────────────────────
   Height above the town's level (the DEM's median inside the town),
   from a surface model: it carries tree canopies and roofs as bumps of
   a few metres, so anything under 3 m is taken as level ground. The
   town and the water are held level, and away from them the ground may
   rise no faster than 1 in 3 — the banks come up gently, the hills
   (Brauhausberg, Pfingstberg, Ruinenberg) keep their tops. */
let terrain: City['terrain'];
if (existsSync(`data/${id}/dem.json`)) {
  const d = JSON.parse(readFileSync(`data/${id}/dem.json`, 'utf8')) as { x0: number; z0: number; step: number; nx: number; nz: number; h: number[] };
  const { x0, z0, step, nx, nz } = d;
  const townH: number[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (inside(hist.town, x0 + i * step, z0 + j * step)) townH.push(d.h[j * nx + i]!);
  townH.sort((a, b) => a - b);
  const base = townH[townH.length >> 1] ?? 0;
  const water = [...areas, ...region].filter((a) => a.kind === 'water');
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    let v = Math.max(0, d.h[j * nx + i]! - base - 3);
    if (inside(hist.town, x, z) || water.some((a) => inside(a.outer, x, z) && !(a.holes ?? []).some((q) => inside(q, x, z)))) v = 0;
    // and level inside the mapped bounds' margin too, where the plan is drawn in detail
    if (x > bx0 - 40 && x < bx1 + 40 && z > bz0 - 40 && z < bz1 + 40 && v < 6) v = 0;
    h[j * nx + i] = v;
  }
  // slope clamp, chamfer passes both ways
  const s1 = step / 3, s2 = step * Math.SQRT2 / 3;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i > 0) h[k] = Math.min(h[k]!, h[k - 1]! + s1);
      if (j > 0) h[k] = Math.min(h[k]!, h[k - nx]! + s1);
      if (i > 0 && j > 0) h[k] = Math.min(h[k]!, h[k - nx - 1]! + s2);
      if (i < nx - 1 && j > 0) h[k] = Math.min(h[k]!, h[k - nx + 1]! + s2);
    }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (i < nx - 1) h[k] = Math.min(h[k]!, h[k + 1]! + s1);
      if (j < nz - 1) h[k] = Math.min(h[k]!, h[k + nx]! + s1);
      if (i < nx - 1 && j < nz - 1) h[k] = Math.min(h[k]!, h[k + nx + 1]! + s2);
      if (i > 0 && j < nz - 1) h[k] = Math.min(h[k]!, h[k + nx - 1]! + s2);
    }
  }
  const dm = new Int16Array(nx * nz);
  for (let k = 0; k < dm.length; k++) dm[k] = Math.round(h[k]! * 10);
  terrain = { x0, z0, step, nx, nz, dm: Buffer.from(dm.buffer).toString('base64') };
  console.log('terrain: base', base, 'm, max', h.reduce((a, b) => Math.max(a, b), 0).toFixed(1), 'm');
}

/* ── Clip to bounds and write ─────────────────────────────────── */
const keepRing = (r: Ring) => { for (let i = 0; i < r.length; i += 2) if (inBounds([r[i]!, r[i + 1]!])) return true; return false; };
const city: City = {
  id, name: hist.name, year: YEAR, origin: spec.origin,
  bounds: [round(bx0), round(bz0), round(bx1), round(bz1)],
  region, regionBounds,
  ...(terrain ? { terrain } : {}),
  spawn: hist.spawn,
  buildings,
  areas: areas.filter((a) => keepRing(a.outer) || a.kind === 'water'),
  streets: streets.filter((s) => keepRing(s.pts)),
  walls: walls.filter((w) => keepRing(w.pts)),
  rails: rails.filter((r) => keepRing(r.pts)),
  trees, columns, lamps, labels,
  water: hist.water,
  centre: hist.centre,
  bells: hist.bells,
  ...(spec.map ? { map: { file: spec.map.file, caption: hist.mapCaption ?? '' } } : {}),
  credits: hist.credits,
};
mkdirSync(`src/cities/${id}`, { recursive: true });
writeFileSync(`src/cities/${id}/city.json`, JSON.stringify(city));
console.log(stats, streetStats, { buildings: buildings.length, areas: city.areas.length, streets: city.streets.length, walls: city.walls.length, rails: city.rails.length, trees: trees.length });
