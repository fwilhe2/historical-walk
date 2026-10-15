/* ── Landmarks, part by part ────────────────────────────────────
   A landmark is described in its city's history file as a function
   of its mapped footprint: a local frame (centre, the direction its
   front faces, its extents along and across) and a few helpers that
   turn boxes and polygons in that frame into Building parts. Parts
   are ordinary buildings with a base height, so towers are stacked
   boxes, drums are polygons, domes and spires are roof profiles —
   all drawn by the same massing and facade code as every house. */
import { centroid, obb, type Ring } from '../src/geom/poly.ts';
import type { Building, Column, RoofShape } from '../src/city/types.ts';

export interface Frame {
  cx: number; cz: number;
  fx: number; fz: number;     // unit vector the front faces
  rx: number; rz: number;     // unit vector to the right of someone standing before the front, facing it
  front: number; back: number; left: number; right: number;   // extents from the centre, m
  at(u: number, f: number): [number, number];                 // local (u right, f toward the front) → world
  local(x: number, z: number): [number, number];              // world → local
}

/* The frame of a footprint whose front faces about the given bearing
   (degrees, 0 north, 90 east); the bearing is snapped to the nearest
   axis of the footprint's enclosing rectangle, so the parts line up
   with the mapped walls. Extents are measured on the ring. */
export function frame(ring: Ring, bearing: number): Frame {
  const [cx, cz] = centroid(ring);
  const b = bearing * Math.PI / 180;
  let fx = Math.sin(b), fz = -Math.cos(b);
  const box = obb(ring);
  let best = -2;
  for (let k = 0; k < 4; k++) {
    const a = box.ang + k * Math.PI / 2, ax = Math.cos(a), az = Math.sin(a);
    const d = ax * Math.sin(b) - az * Math.cos(b);
    if (d > best) { best = d; fx = ax; fz = az; }
  }
  // viewer stands in front looking back at the building: their right is the building's left
  const rx = fz, rz = -fx;
  let front = 0, back = 0, left = 0, right = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const dx = ring[i]! - cx, dz = ring[i + 1]! - cz;
    const f = dx * fx + dz * fz, u = dx * rx + dz * rz;
    front = Math.max(front, f); back = Math.max(back, -f);
    right = Math.max(right, u); left = Math.max(left, -u);
  }
  return {
    cx, cz, fx, fz, rx, rz, front, back, left, right,
    at: (u, f) => [cx + rx * u + fx * f, cz + rz * u + fz * f],
    local: (x, z) => [(x - cx) * rx + (z - cz) * rz, (x - cx) * fx + (z - cz) * fz],
  };
}

export interface PartStyle {
  colour: string; roofColour?: string; roof?: RoofShape; roofH?: number;
  kind?: Building['kind']; wall?: Building['wall']; windows?: false; storey?: number; ridgeAlong?: 'front' | 'across';
}

export class Parts {
  list: Building[] = [];
  columns: Column[] = [];
  private n = 0;
  // the mapped footprint's courtyards, used when footprint() is given the mapped ring
  mapped: { outer: Ring; holes: Ring[] } | null = null;
  readonly id: string; readonly F: Frame; readonly name: string; readonly year: number | undefined;
  constructor(id: string, F: Frame, name: string, year?: number) { this.id = id; this.F = F; this.name = name; this.year = year; }
  private push(outer: Ring, base: number, top: number, s: PartStyle) {
    const b: Building = {
      id: `lm:${this.id}:${this.n++}`, src: 'model', outer, eave: top, roofH: s.roofH ?? 0, roof: s.roof ?? 'flat',
      storey: s.storey ?? 5, colour: s.colour, roofColour: s.roofColour ?? '#5c6066',
    };
    if (base > 0) b.base = base;
    if (s.kind) b.kind = s.kind;
    if (s.wall) b.wall = s.wall;
    if (s.windows === false) b.windows = false;
    if (s.ridgeAlong) {
      const v = s.ridgeAlong === 'front' ? [this.F.fx, this.F.fz] : [this.F.rx, this.F.rz];
      b.ridge = Math.atan2(v[1]!, v[0]!);
    }
    if (this.n === 1) { b.name = this.name; if (this.year) b.year = this.year; }
    this.list.push(b);
    return b;
  }
  /* A box centred at (u, f) in the frame, w wide (along u) and d deep
     (along f), from base to top. */
  box(u: number, f: number, w: number, d: number, base: number, top: number, s: PartStyle) {
    const c = [[u - w / 2, f - d / 2], [u + w / 2, f - d / 2], [u + w / 2, f + d / 2], [u - w / 2, f + d / 2]];
    return this.push(orientPos(c.flatMap(([a, b]) => this.F.at(a!, b!))), base, top, s);
  }
  /* A regular n-gon of circumradius r centred at (u, f). */
  ngon(u: number, f: number, r: number, n: number, base: number, top: number, s: PartStyle) {
    const pts: number[] = [];
    for (let k = 0; k < n; k++) { const a = (k + 0.5) / n * Math.PI * 2; pts.push(...this.F.at(u + r * Math.cos(a), f + r * Math.sin(a))); }
    return this.push(orientPos(pts), base, top, s);
  }
  /* A regular n-gon at world coordinates. */
  ngonAt(x: number, z: number, r: number, n: number, base: number, top: number, s: PartStyle) {
    const pts: number[] = [];
    for (let k = 0; k < n; k++) { const a = (k + 0.5) / n * Math.PI * 2; pts.push(x + r * Math.cos(a), z + r * Math.sin(a)); }
    return this.push(orientPos(pts), base, top, s);
  }
  /* An ellipse of semi-axes a (along u) and b (along f). */
  oval(u: number, f: number, a: number, b: number, n: number, base: number, top: number, s: PartStyle) {
    const pts: number[] = [];
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n * Math.PI * 2; pts.push(...this.F.at(u + a * Math.cos(t), f + b * Math.sin(t))); }
    return this.push(orientPos(pts), base, top, s);
  }
  /* A round arch: the opening of width w centred at u, its crown at
     `crown`, springing at crown − w/2, filled above in thin slices up
     to `top`, d deep. */
  arch(u: number, f: number, w: number, d: number, crown: number, top: number, s: PartStyle, n = 9) {
    const r = w / 2, spring = crown - r;
    for (let k = 0; k < n; k++) {
      const a = -r + (k + 0.5) * w / n;
      const y = spring + Math.sqrt(Math.max(0, r * r - a * a));
      this.box(u + a, f, w / n + 0.02, d, y, top, s);
    }
  }
  /* A balustrade round a square stage of side w at height y, and an
     urn on each corner. */
  balustrade(u: number, f: number, w: number, y: number, s: PartStyle, h = 1.1) {
    const t = 0.35, st = { ...s, windows: false as const };
    this.box(u, f + w / 2 - t / 2, w, t, y, y + h, st);
    this.box(u, f - w / 2 + t / 2, w, t, y, y + h, st);
    this.box(u + w / 2 - t / 2, f, t, w - 2 * t, y, y + h, st);
    this.box(u - w / 2 + t / 2, f, t, w - 2 * t, y, y + h, st);
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      this.ngon(u + a * (w / 2 - 0.3), f + b * (w / 2 - 0.3), 0.32, 8, y + h, y + h + 1.2, { ...st, roof: 'dome', roofH: 0.35, roofColour: s.colour });
    }
  }
  /* The mapped footprint itself, as one part. */
  footprint(ring: Ring, base: number, top: number, s: PartStyle) {
    const b = this.push(orientPos(ring), base, top, s);
    if (this.mapped && ring === this.mapped.outer && this.mapped.holes.length) b.holes = this.mapped.holes;
    return b;
  }
  column(u: number, f: number, r: number, h: number, base = 0) {
    const [x, z] = this.F.at(u, f);
    this.columns.push({ x: +x.toFixed(2), z: +z.toFixed(2), r, h, base });
  }
  /* A ring of n columns of radius r on a circle of radius R. */
  colonnade(u: number, f: number, R: number, n: number, r: number, h: number, base: number) {
    for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; this.column(u + R * Math.cos(a), f + R * Math.sin(a), r, h, base); }
  }
}

function orientPos(r: Ring): Ring {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j]! * r[i + 1]! - r[i]! * r[j + 1]!;
  if (a > 0) return r.map((v) => Math.round(v * 100) / 100);
  const o: Ring = [];
  for (let i = r.length - 2; i >= 0; i -= 2) o.push(Math.round(r[i]! * 100) / 100, Math.round(r[i + 1]! * 100) / 100);
  return o;
}

export interface Landmark {
  id: string;
  name: string;
  year?: number;
  at: [number, number];           // a point inside the mapped footprint it replaces
  front: number;                  // bearing its front faces, degrees
  build(P: Parts, ring: Ring): void;
  about?: string;                 // a sentence or two for the HUD, from the cited sources
  // Keep the mapped building and only add the parts (a tower on a
  // building that stands today); its own name and patch still apply.
  keep?: boolean;
  // Remove every other building whose centre is inside this ring
  // (local metres) — parts of the same landmark mapped separately.
  clear?: Ring;
}
