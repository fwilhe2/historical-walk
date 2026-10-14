/* Reading the reduced OSM/OHM files (tools/fetch.ts): projection to
   the local frame, ways and multipolygons to rings, date tags. */
import { readFileSync } from 'node:fs';

export type Tags = Record<string, string>;
export interface RawFile {
  nodes: Record<string, [number, number, Tags?]>;
  ways: { id: number; nodes: number[]; tags: Tags }[];
  relations: { id: number; members: [number, string][]; tags: Tags }[];
}
export type Pt = [number, number];   // local x (east), z (south), metres
export interface Feature { id: string; tags: Tags; outer: Pt[][]; inner: Pt[][]; line?: Pt[]; closed: boolean }

/* Local equirectangular frame. Over 2 km the error against a proper
   projection is millimetres. */
export function projector(lat0: number, lon0: number) {
  const φ = lat0 * Math.PI / 180;
  const mLat = 111132.954 - 559.822 * Math.cos(2 * φ) + 1.175 * Math.cos(4 * φ);
  const mLon = 111412.84 * Math.cos(φ) - 93.5 * Math.cos(3 * φ);
  return {
    fwd: (lat: number, lon: number): Pt => [(lon - lon0) * mLon, -(lat - lat0) * mLat],
    inv: (x: number, z: number): [number, number] => [lat0 - z / mLat, lon0 + x / mLon],
  };
}

/* A year from an OSM date tag: "1752", "1793-09-16", "~1780",
   "before 1800", "C18" … Unparseable gives undefined. */
export function year(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /(\d{4})/.exec(s);
  if (m) return +m[1]!;
  const c = /C(\d{2})/.exec(s);   // century, "C18" = 1700s; take its middle
  if (c) return (+c[1]! - 1) * 100 + 50;
  return undefined;
}

/* Alive in the given year: started on or before it and not ended
   before it (end_date is the first date the feature is gone, or its
   last — OHM uses both; an end in the year itself counts as gone only
   if it is a full date earlier than 1 July). */
export function aliveIn(t: Tags, y: number) {
  const a = year(t.start_date), b = year(t.end_date);
  if (a !== undefined && a > y) return false;
  if (b !== undefined && b < y) return false;
  if (b === y && t.end_date && /^\d{4}-0[1-6]/.test(t.end_date)) return false;
  return true;
}

export function load(path: string, fwd: (lat: number, lon: number) => Pt) {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RawFile;
  const P = new Map<number, Pt>();
  const pointTags: { id: string; tags: Tags; p: Pt }[] = [];
  for (const [id, v] of Object.entries(raw.nodes)) {
    const p = fwd(v[0], v[1]);
    P.set(+id, p);
    if (v[2]) pointTags.push({ id: 'n' + id, tags: v[2], p });
  }
  const wayPts = (nodes: number[]) => nodes.map((n) => P.get(n)).filter((p): p is Pt => !!p);
  const ways = new Map(raw.ways.map((w) => [w.id, w]));
  const memberWays = new Set<number>();
  const feats: Feature[] = [];
  for (const r of raw.relations) {
    const isMP = r.tags.type === 'multipolygon' || r.tags.type === 'building';
    const lines: { pts: number[]; role: string }[] = [];
    for (const [ref, role] of r.members) {
      const w = ways.get(ref);
      if (!w) continue;
      lines.push({ pts: w.nodes, role });
      // A member way without tags of its own is just geometry.
      if (Object.keys(w.tags).length === 0 || (isMP && sameTags(w.tags, r.tags))) memberWays.add(ref);
    }
    if (isMP) {
      const outer = joinRings(lines.filter((l) => l.role !== 'inner').map((l) => l.pts)).map(wayPts).filter((p) => p.length >= 3);
      const inner = joinRings(lines.filter((l) => l.role === 'inner').map((l) => l.pts)).map(wayPts).filter((p) => p.length >= 3);
      if (outer.length) feats.push({ id: 'r' + r.id, tags: r.tags, outer, inner, closed: true });
    } else {
      // multilinestring (OHM streets) and the like: each member a line
      for (const l of lines) {
        const pts = wayPts(l.pts);
        if (pts.length >= 2) feats.push({ id: 'r' + r.id + '/' + l.pts[0], tags: r.tags, outer: [], inner: [], line: pts, closed: false });
      }
    }
  }
  for (const w of raw.ways) {
    if (memberWays.has(w.id) && Object.keys(w.tags).length === 0) continue;
    if (Object.keys(w.tags).length === 0) continue;
    const pts = wayPts(w.nodes);
    if (pts.length < 2) continue;
    const closed = w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1];
    if (closed) feats.push({ id: 'w' + w.id, tags: w.tags, outer: [pts.slice(0, -1)], inner: [], line: pts, closed: true });
    else feats.push({ id: 'w' + w.id, tags: w.tags, outer: [], inner: [], line: pts, closed: false });
  }
  return { feats, points: pointTags };
}

function sameTags(a: Tags, b: Tags) {
  const ka = Object.keys(a).filter((k) => k !== 'type'), kb = Object.keys(b).filter((k) => k !== 'type');
  return ka.length > 0 && ka.every((k) => b[k] === a[k]) && ka.length <= kb.length;
}

/* Join open member ways into closed rings by shared end nodes. Ways
   that cannot be closed are dropped (a relation cut by the bbox). */
export function joinRings(parts: number[][]): number[][] {
  const rings: number[][] = [];
  const open = parts.map((p) => p.slice());
  while (open.length) {
    let cur = open.pop()!;
    let guard = 0;
    while (cur[0] !== cur[cur.length - 1] && guard++ < 1000) {
      const end = cur[cur.length - 1];
      const i = open.findIndex((p) => p[0] === end || p[p.length - 1] === end);
      if (i < 0) break;
      const nxt = open.splice(i, 1)[0]!;
      cur = cur.concat(nxt[0] === end ? nxt.slice(1) : nxt.slice().reverse().slice(1));
    }
    if (cur.length > 3 && cur[0] === cur[cur.length - 1]) rings.push(cur.slice(0, -1));
  }
  return rings;
}
