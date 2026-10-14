/* Download the raw map data for a city and keep only what the walk
   draws. Run once (bun run fetch potsdam); the reduced files under
   data/<city>/ are committed, so building the city never needs the
   network.

   - OpenStreetMap, today's map, from the editing API's /map call in
     tiles (Overpass is often too busy for a whole old town at once).
     Most of the old buildings in the baroque extension still stand
     and are mapped here, footprint by footprint.
   - OpenHistoricalMap, the same data model with start_date/end_date
     on every feature: the lost buildings (Stadtschloss,
     Garnisonkirche, …) and old streets and water. CC0.
   - A historical map as a raster, when the city has one (CitySpec.map):
     for Potsdam the Messtischblatt sheets of 1903 from the Land's WMS,
     at about a metre a pixel, stored grey. tools/mask.ts reads the
     built-up blocks from its hatching.

   Usage: node tools/fetch.ts <city> */
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { CITIES } from './cities.ts';
import { projector } from './osm.ts';

const UA = 'historical-walk/0.1 (https://github.com/fwilhe2/historical-walk)';
type Tags = Record<string, string>;
interface RawNode { type: 'node'; id: number; lat: number; lon: number; tags?: Tags }
interface RawWay { type: 'way'; id: number; nodes: number[]; tags?: Tags }
interface RawRel { type: 'relation'; id: number; members: { type: string; ref: number; role: string }[]; tags?: Tags }
type Raw = RawNode | RawWay | RawRel;

// What a feature must carry to be kept. Nodes are kept when a kept
// way uses them, or when they are a point feature themselves.
const AREA_KEYS = ['building', 'building:part', 'highway', 'waterway', 'natural', 'landuse', 'leisure', 'amenity',
  'railway', 'barrier', 'man_made', 'bridge', 'area:highway', 'place', 'historic', 'tourism', 'water'];
const POINT_KEYS = ['natural', 'historic', 'amenity', 'tourism', 'man_made', 'highway'];
const keepWay = (t?: Tags) => !!t && AREA_KEYS.some((k) => k in t);
const keepPoint = (t?: Tags) => !!t && POINT_KEYS.some((k) => k in t);

async function get(url: string, init?: RequestInit, tries = 6): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init?.headers ?? {}) } });
      const body = await r.text();
      if (r.ok && body.trimStart().startsWith('{')) return body;
      throw new Error(`${r.status} ${body.slice(0, 200)}`);
    } catch (e) {
      if (i >= tries) throw e;
      console.warn(`  retry ${i + 1}: ${(e as Error).message.slice(0, 120)}`);
      await new Promise((ok) => setTimeout(ok, 5000 * (i + 1)));
    }
  }
}

function reduce(all: Map<string, Raw>) {
  const nodes = new Map<number, RawNode>(), ways = new Map<number, RawWay>(), rels = new Map<number, RawRel>();
  for (const e of all.values()) {
    if (e.type === 'node') nodes.set(e.id, e);
    else if (e.type === 'way') ways.set(e.id, e);
    else rels.set(e.id, e);
  }
  const keptRels = [...rels.values()].filter((r) => keepWay(r.tags));
  const wayIds = new Set<number>();
  for (const w of ways.values()) if (keepWay(w.tags)) wayIds.add(w.id);
  for (const r of keptRels) for (const m of r.members) if (m.type === 'way' && ways.has(m.ref)) wayIds.add(m.ref);
  const keptWays = [...wayIds].map((id) => ways.get(id)!);
  const nodeIds = new Set<number>();
  for (const w of keptWays) for (const n of w.nodes) nodeIds.add(n);
  for (const n of nodes.values()) if (keepPoint(n.tags)) nodeIds.add(n.id);
  const out = {
    // [lat, lon] to 7 places (about a centimetre), tags only where there are any.
    nodes: Object.fromEntries([...nodeIds].filter((id) => nodes.has(id)).map((id) => {
      const n = nodes.get(id)!;
      const v: (number | Tags)[] = [+n.lat.toFixed(7), +n.lon.toFixed(7)];
      if (n.tags) v.push(n.tags);
      return [id, v];
    })),
    ways: keptWays.map((w) => ({ id: w.id, nodes: w.nodes, tags: w.tags ?? {} })),
    relations: keptRels.map((r) => ({ id: r.id, members: r.members.filter((m) => m.type === 'way').map((m) => [m.ref, m.role]), tags: r.tags ?? {} })),
  };
  return out;
}

async function osm(bbox: [number, number, number, number], step: number) {
  const [s, w, n, e] = bbox;
  const all = new Map<string, Raw>();
  for (let lat = s; lat < n - 1e-9; lat += step) {
    for (let lon = w; lon < e - 1e-9; lon += step) {
      const b = [lon, lat, Math.min(lon + step, e), Math.min(lat + step, n)].map((v) => v.toFixed(5)).join(',');
      console.log(`osm tile ${b}`);
      const j = JSON.parse(await get(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${b}`)) as { elements: Raw[] };
      for (const el of j.elements) all.set(el.type + el.id, el);
    }
  }
  // Ways crossing a tile edge are complete (the API returns all their
  // nodes); relations may miss members outside the bbox, which only
  // matters for features we would clip anyway.
  return reduce(all);
}

async function ohm(bbox: [number, number, number, number]) {
  const b = bbox.join(',');
  const q = `[out:json][timeout:170];(nwr(${b});<;>;);out body;`;
  console.log('ohm overpass');
  const j = JSON.parse(await get('https://overpass-api.openhistoricalmap.org/api/interpreter', {
    method: 'POST', body: new URLSearchParams({ data: q }),
  })) as { elements: Raw[] };
  const all = new Map<string, Raw>();
  for (const el of j.elements) all.set(el.type + el.id, el);
  return reduce(all);
}

const id = process.argv[2] ?? 'potsdam';
const city = CITIES[id];
if (!city) throw new Error(`unknown city ${id}; known: ${Object.keys(CITIES).join(', ')}`);
const dir = `data/${id}`;
mkdirSync(dir, { recursive: true });
async function historicalMap(spec: NonNullable<(typeof CITIES)[string]['map']>, bb: [number, number, number, number], origin: [number, number]) {
  const [s, w, n, e] = bb;
  const { fwd } = projector(origin[0], origin[1]);
  const [x0, z0] = fwd(n, w), [x1, z1] = fwd(s, e);
  // About a metre a pixel; the WMS resamples the scan (1:25 000 at
  // its scanning resolution is 1.5–2 m a pixel), and EPSG:4326 keeps
  // pixels linear in lat/lon like the local frame.
  const W = Math.round((x1 - x0) / spec.mpp), H = Math.round((z1 - z0) / spec.mpp);
  const url = `${spec.wms}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${spec.layer}&STYLES=&SRS=EPSG:4326&BBOX=${w},${s},${e},${n}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/png`;
  console.log('historical map', W, 'x', H);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('map ' + r.status);
  const png = PNG.sync.read(Buffer.from(await r.arrayBuffer()));
  const grey = new PNG({ width: png.width, height: png.height, colorType: 0, inputColorType: 0, bitDepth: 8, inputHasAlpha: false });
  grey.data = Buffer.alloc(png.width * png.height);
  for (let i = 0; i < png.width * png.height; i++) {
    grey.data[i] = Math.round(0.299 * png.data[4 * i]! + 0.587 * png.data[4 * i + 1]! + 0.114 * png.data[4 * i + 2]!);
  }
  return PNG.sync.write(grey, { colorType: 0, inputColorType: 0, inputHasAlpha: false });
}

/* The land round the town, coarsely: water, woods and the old parks
   in a box a few kilometres wider than the town's, from Overpass with
   geometry. Kept as rings of [lat, lon] per feature. */
async function region(bb: [number, number, number, number]) {
  const b = bb.join(',');
  const sel = ['way["natural"="water"]', 'relation["natural"="water"]', 'way["landuse"="forest"]', 'relation["landuse"="forest"]',
    'way["natural"="wood"]', 'relation["natural"="wood"]', 'way["leisure"="park"]', 'relation["leisure"="park"]'];
  const q = `[out:json][timeout:160];(${sel.map((x) => `${x}(${b});`).join('')});out geom qt;`;
  console.log('region overpass');
  const j = JSON.parse(await get('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }) })) as {
    elements: { type: string; id: number; tags?: Tags; geometry?: { lat: number; lon: number }[]; members?: { role: string; geometry?: { lat: number; lon: number }[] }[] }[];
  };
  const out: { kind: string; name?: string; outer: number[][]; inner: number[][] }[] = [];
  const flatLL = (g: { lat: number; lon: number }[]) => g.flatMap((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)]);
  for (const e of j.elements) {
    const t = e.tags ?? {};
    const kind = t.natural === 'water' ? 'water' : t.leisure === 'park' ? 'park' : 'wood';
    if (e.type === 'way' && e.geometry && e.geometry.length > 3) out.push({ kind, ...(t.name ? { name: t.name } : {}), outer: [flatLL(e.geometry)], inner: [] });
    else if (e.members) {
      // members as open lines; joined by matching end coordinates
      const join = (role: string) => {
        const parts = e.members!.filter((m) => (role === 'inner') === (m.role === 'inner') && m.geometry).map((m) => flatLL(m.geometry!));
        const rings: number[][] = [];
        while (parts.length) {
          let cur = parts.pop()!;
          for (let guard = 0; guard < 500; guard++) {
            const n = cur.length;
            if (cur[0] === cur[n - 2] && cur[1] === cur[n - 1]) break;
            const i = parts.findIndex((p) => (p[0] === cur[n - 2] && p[1] === cur[n - 1]) || (p[p.length - 2] === cur[n - 2] && p[p.length - 1] === cur[n - 1]));
            if (i < 0) break;
            let p = parts.splice(i, 1)[0]!;
            if (!(p[0] === cur[n - 2] && p[1] === cur[n - 1])) { const r: number[] = []; for (let k = p.length - 2; k >= 0; k -= 2) r.push(p[k]!, p[k + 1]!); p = r; }
            cur = cur.concat(p.slice(2));
          }
          if (cur.length > 6) rings.push(cur);
        }
        return rings;
      };
      out.push({ kind, ...(t.name ? { name: t.name } : {}), outer: join('outer'), inner: join('inner') });
    }
  }
  return out;
}

const which = process.argv[3];
if (!which || which === 'osm') writeFileSync(`${dir}/osm.json`, JSON.stringify(await osm(city.bbox, 0.006)));
if (!which || which === 'ohm') writeFileSync(`${dir}/ohm.json`, JSON.stringify(await ohm(city.bbox)));
if ((!which || which === 'region') && city.region) writeFileSync(`${dir}/region.json`, JSON.stringify(await region(city.region)));
if ((!which || which === 'map') && city.map) writeFileSync(`${dir}/${city.map.file}`, await historicalMap(city.map, city.bbox, city.origin));
console.log('done');
