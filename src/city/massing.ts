/* ── Massing: walls and roofs of one building ───────────────────
   Pure (no three): the arrays this writes become BufferGeometry in
   city/buildings.ts.

   A roof is the lower envelope of a few planes over the footprint,
   f(x, z) = min_i (c_i + gx_i·x + gz_i·z), height above the eaves.
   The planes come from the footprint's enclosing rectangle and the
   roof's shape: two for a gable, four for a hip, eight for a mansard
   (each side a steep and a shallow plane), plus a flat cap at the
   ridge height. Each plane owns the convex region where it is the
   lowest; the footprint's triangles are clipped to that region and
   lifted onto the plane, so faces are planar and ridges and hips
   are exact. Walls follow f along each edge (it is piecewise linear;
   its kinks are where two planes are equal), which makes gables
   where the edge runs across the ridge.

   A footprint that fills its rectangle poorly (an L, a U, a block
   with a courtyard) gets a roof that rises at the same pitch from
   every eave instead, f = min(H, k·distance to the outline) — what a
   carpenter would build — meshed on refined triangles, since that
   surface is only piecewise planar along its (unknown) skeleton. */
import earcut from 'earcut';
import { fit, obb, area, orient, segDist2, type Ring } from '../geom/poly';
import type { Building } from './types';

export interface WallBuf { pos: number[]; nrm: number[]; uv: number[]; fac: number[]; col: number[] }
export interface RoofBuf { pos: number[]; nrm: number[]; uv: number[]; col: number[]; src: number[]; cur: number }
export const wallBuf = (): WallBuf => ({ pos: [], nrm: [], uv: [], fac: [], col: [] });
export const roofBuf = (): RoofBuf => ({ pos: [], nrm: [], uv: [], col: [], src: [], cur: 0 });

type Plane = [number, number, number];   // c, gx, gz
const SRC_CODE = { osm: 0, ohm: 1, mtb: 2, model: 3 } as const;

export function hexRGB(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  // sRGB → linear, since the buffers feed a linear pipeline
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [lin((v >> 16) & 255), lin((v >> 8) & 255), lin(v & 255)];
}

/* The roof planes, in world x/z, for a building's shape. */
/* Distance roofs rise with the distance d from the outline:
   'hip'   min(H, k·d)                 a hipped roof on any outline
   'dome'  H·√(1 − (1 − d/R)²)        a dome over a round (polygonal) drum
   'spire' H·d/R                       a pyramid of as many faces as the outline has sides
   R is the outline's inradius, about the rectangle's half-width. */
export type Profile = 'hip' | 'dome' | 'spire';
export interface RoofPlan {
  planes: Plane[]; mode: 'planes' | 'distance'; H: number; k: number; profile: Profile; R: number;
  box?: { cx: number; cz: number; ang: number; A: number; B: number };   // the rectangle plane roofs are built on
}

export function roofPlanes(b: Building): RoofPlan {
  const H = b.roofH;
  const none = { profile: 'hip' as Profile, R: 1 };
  if (b.roof === 'flat' || H <= 0.05) return { planes: [[0, 0, 0]], mode: 'planes', H: 0, k: 0, ...none };
  let box = b.ridge !== undefined ? fit(b.outer, b.ridge) : obb(b.outer);
  if (b.roof === 'dome' || b.roof === 'spire') {
    const R = Math.max(0.1, Math.min(box.a, box.b));
    return { planes: [], mode: 'distance', H, k: H / R, profile: b.roof, R };
  }
  if (b.ridge === undefined && box.a < box.b) box = fit(b.outer, box.ang + Math.PI / 2);
  const A = box.a, B = box.b;
  const fill = Math.abs(area(b.outer)) / (4 * A * B);
  const holes = (b.holes?.length ?? 0) > 0;
  if ((fill < 0.72 && B > 7) || holes) {
    // Distance roof; same pitch as the rectangle's would have had,
    // but no taller than a wing of ordinary depth makes it.
    const k = Math.min(H / Math.max(B, 1), 1.2);
    return { planes: [], mode: 'distance', H: Math.min(H, k * 7.5), k, ...none };
  }
  const c = Math.cos(box.ang), s = Math.sin(box.ang);
  const P = (a0: number, au: number, av: number): Plane => {
    const gx = au * c - av * s, gz = au * s + av * c;
    return [a0 - gx * box.cx - gz * box.cz, gx, gz];
  };
  const k = H / B;
  const planes: Plane[] = [P(H, 0, 0)];
  switch (b.roof) {
    case 'gabled':
      planes.push(P(H, 0, -k), P(H, 0, k));
      break;
    case 'hipped':
      planes.push(P(H, 0, -k), P(H, 0, k), P(k * A, -k, 0), P(k * A, k, 0));
      break;
    case 'half-hipped': {
      const k2 = k * 2.2, h0 = H * 0.62;
      planes.push(P(H, 0, -k), P(H, 0, k), P(h0 + k2 * A, -k2, 0), P(h0 + k2 * A, k2, 0));
      break;
    }
    case 'pyramidal':
      planes.push(P(H, 0, -H / B), P(H, 0, H / B), P(H, -H / A, 0), P(H, H / A, 0));
      break;
    case 'mansard': {
      // Lower slope over the outer quarter of the half-depth rising to
      // two thirds of the height (about 70°), the upper one shallow.
      const w = 0.25 * B, h1 = 0.68 * H, k1 = h1 / w, k2 = (H - h1) / (B - w);
      planes.push(P(k1 * B, 0, -k1), P(h1 + k2 * (B - w), 0, -k2), P(k1 * B, 0, k1), P(h1 + k2 * (B - w), 0, k2));
      planes.push(P(k1 * A, -k1, 0), P(h1 + k2 * (A - w), -k2, 0), P(k1 * A, k1, 0), P(h1 + k2 * (A - w), k2, 0));
      break;
    }
  }
  return { planes, mode: 'planes', H, k, ...none, box: { cx: box.cx, cz: box.cz, ang: box.ang, A, B } };
}

function distanceLift(rp: RoofPlan, d: number) {
  if (rp.profile === 'hip') return Math.min(rp.H, rp.k * d);
  const t = Math.min(1, d / rp.R);
  return rp.profile === 'dome' ? rp.H * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))) : rp.H * t;
}

const evalP = (p: Plane, x: number, z: number) => p[0] + p[1] * x + p[2] * z;
function envelope(planes: Plane[], x: number, z: number) {
  let m = Infinity;
  for (const p of planes) { const v = evalP(p, x, z); if (v < m) m = v; }
  return m;
}

// Distance from a point to the nearest edge of the outline and holes.
function boundaryDist(rings: Ring[], x: number, z: number) {
  let m = Infinity;
  for (const r of rings) {
    const n = r.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const d = segDist2(x, z, r[j]!, r[j + 1]!, r[i]!, r[i + 1]!);
      if (d < m) m = d;
    }
  }
  return Math.sqrt(m);
}

/* Clip a convex polygon (flat x,z list) to c + gx·x + gz·z ≤ 0. */
function clipHalf(poly: number[], c: number, gx: number, gz: number): number[] {
  const out: number[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = poly[i]!, az = poly[i + 1]!, bx = poly[j]!, bz = poly[j + 1]!;
    const da = c + gx * ax + gz * az, db = c + gx * bx + gz * bz;
    if (da <= 0) out.push(ax, az);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push(ax + (bx - ax) * t, az + (bz - az) * t);
    }
  }
  return out;
}

function pushTri(buf: RoofBuf, p: number[], nx: number, ny: number, nz: number, uv: number[], col: [number, number, number]) {
  // Wind so the face's own normal agrees with the one we want.
  const e1x = p[3]! - p[0]!, e1y = p[4]! - p[1]!, e1z = p[5]! - p[2]!;
  const e2x = p[6]! - p[0]!, e2y = p[7]! - p[1]!, e2z = p[8]! - p[2]!;
  const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
  const flip = cx * nx + cy * ny + cz * nz < 0;
  const order = flip ? [0, 2, 1] : [0, 1, 2];
  for (const k of order) {
    buf.pos.push(p[3 * k]!, p[3 * k + 1]!, p[3 * k + 2]!);
    buf.nrm.push(nx, ny, nz);
    buf.uv.push(uv[2 * k]!, uv[2 * k + 1]!);
    buf.col.push(col[0], col[1], col[2]);
    buf.src.push(buf.cur);
  }
}

/* Roof faces over the footprint. */
function roofFaces(b: Building, rp: RoofPlan, out: RoofBuf, top: number) {
  const rings = [b.outer, ...(b.holes ?? [])];
  const data: number[] = [], holeIdx: number[] = [];
  for (let r = 0; r < rings.length; r++) {
    if (r > 0) holeIdx.push(data.length / 2);
    data.push(...rings[r]!);
  }
  const tris = earcut(data, holeIdx.length ? holeIdx : null, 2);
  const col = hexRGB(b.roofColour);
  if (rp.mode === 'planes') {
    const planes = rp.planes;
    for (let i = 0; i < planes.length; i++) {
      const pi = planes[i]!;
      const glen = Math.hypot(pi[1], pi[2]);
      const nx = -pi[1], ny = 1, nz = -pi[2], nl = Math.hypot(nx, ny, nz);
      // Texture axes: along the contour, and up the slope from the eave.
      const tx = glen > 1e-6 ? -pi[2] / glen : 1, tz = glen > 1e-6 ? pi[1] / glen : 0;
      const slopeK = glen > 1e-6 ? Math.sqrt(1 + glen * glen) / glen : 0;
      for (let t = 0; t < tris.length; t += 3) {
        let poly = [0, 1, 2].flatMap((k) => [data[2 * tris[t + k]!]!, data[2 * tris[t + k]! + 1]!]);
        for (let j = 0; j < planes.length && poly.length >= 6; j++) {
          if (j === i) continue;
          const pj = planes[j]!;
          // Ties go to the lower index, so no sliver is drawn twice.
          const eps = j < i ? 1e-7 : -1e-7;
          poly = clipHalf(poly, pi[0] - pj[0] + eps, pi[1] - pj[1], pi[2] - pj[2]);
        }
        if (poly.length < 6) continue;
        const ys = [] as number[];
        for (let k = 0; k < poly.length; k += 2) ys.push(top + evalP(pi, poly[k]!, poly[k + 1]!));
        for (let k = 2; k + 2 < poly.length; k += 2) {
          const ids = [0, k, k + 2];
          const p = ids.flatMap((q) => [poly[q]!, ys[q / 2]!, poly[q + 1]!]);
          const uv = ids.flatMap((q) => glen > 1e-6
            ? [poly[q]! * tx + poly[q + 1]! * tz, (ys[q / 2]! - top) * slopeK]
            : [poly[q]!, poly[q + 1]!]);
          const a2 = (p[3]! - p[0]!) * (p[8]! - p[2]!) - (p[6]! - p[0]!) * (p[5]! - p[2]!);
          if (Math.abs(a2) < 1e-6) continue;
          pushTri(out, p, nx / nl, ny / nl, nz / nl, uv, col);
        }
      }
    }
  } else {
    // Distance roof: refine every triangle to about 1.6 m, lift by the
    // distance field, and shade each small face by its own normal.
    const lift = (x: number, z: number) => distanceLift(rp, boundaryDist(rings, x, z));
    // a dome needs finer facets than a hip to look round
    const fine = rp.profile === 'hip' ? 1.6 : Math.max(0.35, rp.R / 7);
    const emit = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, depth: number) => {
      const lab = (ax - bx) ** 2 + (az - bz) ** 2, lbc = (bx - cx) ** 2 + (bz - cz) ** 2, lca = (cx - ax) ** 2 + (cz - az) ** 2;
      const m = Math.max(lab, lbc, lca);
      if (m > fine * fine && depth < 12) {
        // split the longest edge
        if (m === lab) { const mx = (ax + bx) / 2, mz = (az + bz) / 2; emit(ax, az, mx, mz, cx, cz, depth + 1); emit(mx, mz, bx, bz, cx, cz, depth + 1); }
        else if (m === lbc) { const mx = (bx + cx) / 2, mz = (bz + cz) / 2; emit(ax, az, bx, bz, mx, mz, depth + 1); emit(ax, az, mx, mz, cx, cz, depth + 1); }
        else { const mx = (cx + ax) / 2, mz = (cz + az) / 2; emit(ax, az, bx, bz, mx, mz, depth + 1); emit(mx, mz, bx, bz, cx, cz, depth + 1); }
        return;
      }
      const ya = lift(ax, az), yb = lift(bx, bz), yc = lift(cx, cz);
      const p = [ax, top + ya, az, bx, top + yb, bz, cx, top + yc, cz];
      let nx = (yb - ya) * (cz - az) - (bz - az) * (yc - ya);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (yc - ya) - (yb - ya) * (cx - ax);
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const nl = Math.hypot(nx, ny, nz) || 1;
      const uv = [ax + az, ya * 1.4, bx + bz, yb * 1.4, cx + cz, yc * 1.4];
      pushTri(out, p, nx / nl, ny / nl, nz / nl, uv, col);
    };
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t]!, bb = tris[t + 1]!, c = tris[t + 2]!;
      emit(data[2 * a]!, data[2 * a + 1]!, data[2 * bb]!, data[2 * bb + 1]!, data[2 * c]!, data[2 * c + 1]!, 0);
    }
  }
}

/* Walls round one ring. Outer rings run positive (see geom/poly.ts),
   holes negative, so (dz, −dx) points out of the solid either way. */
function ringWalls(b: Building, r: Ring, rp: RoofPlan, out: WallBuf) {
  const n = r.length;
  const base = b.base ?? 0;
  const col = hexRGB(b.colour);
  // flags: 1 blank, 2 church, 4 grand; 8 × wall style (0 plaster, 1 brick, 2 stone, 3 copper, 4 dormer); 64 ornate; 128 × source
  const style = b.wall === 'brick' ? 1 : b.wall === 'stone' ? 2 : b.wall === 'copper' ? 3 : 0;
  const flags = (b.windows === false ? 1 : 0) + (b.kind === 'church' ? 2 : b.kind === 'palace' || b.kind === 'public' ? 4 : 0) + 8 * style
    + (b.ornate || b.kind === 'palace' ? 64 : 0) + 128 * SRC_CODE[b.src] + (b.shop ? 512 : 0);
  const seed = (parseInt(b.id.replace(/\D/g, '').slice(-6) || '0', 10) % 997) / 997;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = r[i]!, az = r[i + 1]!, bx = r[j]!, bz = r[j + 1]!;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 0.05) continue;
    const nx = dz / L, nz = -dx / L;
    // Kinks of the roof line along this edge.
    const ts = [0, 1];
    if (rp.mode === 'planes') {
      const ps = rp.planes;
      for (let p = 0; p < ps.length; p++) for (let q = p + 1; q < ps.length; q++) {
        const da = evalP(ps[p]!, ax, az) - evalP(ps[q]!, ax, az), db = evalP(ps[p]!, bx, bz) - evalP(ps[q]!, bx, bz);
        if ((da < 0) !== (db < 0) && Math.abs(da - db) > 1e-9) ts.push(da / (da - db));
      }
    }
    ts.sort((x, y) => x - y);
    const f = (t: number) => rp.mode === 'planes' ? Math.max(0, envelope(rp.planes, ax + dx * t, az + dz * t)) : 0;
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k]!, t1 = ts[k + 1]!;
      if (t1 - t0 < 1e-6) continue;
      const x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1;
      const y0 = b.eave + f(t0), y1 = b.eave + f(t1);
      const u0 = t0 * L, u1 = t1 * L;
      // two triangles: (x0,base)-(x1,base)-(x1,y1), (x0,base)-(x1,y1)-(x0,y0); wound to face out
      const quad = [[x0, base, z0, u0, base], [x1, base, z1, u1, base], [x1, y1, z1, u1, y1], [x0, y0, z0, u0, y0]];
      // Check winding of the first triangle against the outward normal.
      const e1 = [x1 - x0, 0, z1 - z0], e2 = [x1 - x0, y1 - base, z1 - z0];
      const cxp = e1[1]! * e2[2]! - e1[2]! * e2[1]!, czp = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
      const order = cxp * nx + czp * nz >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const q of order) {
        const v = quad[q]!;
        out.pos.push(v[0]!, v[1]!, v[2]!);
        out.nrm.push(nx, 0, nz);
        out.uv.push(v[3]!, v[4]!);
        out.fac.push(b.eave, b.storey, L, flags + seed);
        out.col.push(col[0], col[1], col[2]);
      }
    }
  }
}

/* What the details need to know of the neighbours, and where the
   metalwork goes. exposed(a, b) is false for a party wall: an edge
   another building stands against. */
export interface MetalBuf { pos: number[]; nrm: number[] }
export const metalBuf = (): MetalBuf => ({ pos: [], nrm: [] });
// awnings: uv in metres (across the shop, out from the wall), col the stripes' colour
export interface ClothBuf { pos: number[]; nrm: number[]; uv: number[]; col: number[] }
export const clothBuf = (): ClothBuf => ({ pos: [], nrm: [], uv: [], col: [] });
export interface Details { exposed?: (ax: number, az: number, bx: number, bz: number) => boolean; metal?: MetalBuf; cloth?: ClothBuf }

export function buildMassing(b: Building, walls: WallBuf, roofs: RoofBuf, withDormers = true, details: Details = {}) {
  const rp = roofPlanes(b);
  roofs.cur = SRC_CODE[b.src];
  ringWalls(b, b.outer, rp, walls);
  for (const h of b.holes ?? []) ringWalls(b, h, rp, walls);
  roofFaces(b, rp, roofs, b.eave);
  if (withDormers) {
    dormers(b, rp, walls, roofs); chimneys(b, rp, walls, roofs);
    for (const r of [b.outer, ...(b.holes ?? [])]) eaves(b, r, rp, walls, roofs, details);
    if (b.shop && details.cloth) awnings(b, details);
    doorSteps(b, walls, details);
  }
}

/* ── Door steps ────────────────────────────────────────────────────
   A front door stood a step or two above the pavement: a block of
   sandstone or granite before it, 1.9 m wide, 45 cm deep, 17 cm over
   the pavement (an estimate), where the facade shader puts the door — the middle
   bay of a wall of three bays or more — on walls that stand free. */
function doorSteps(b: Building, walls: WallBuf, det: Details) {
  if (b.windows === false || (b.base ?? 0) > 0.5 || b.kind === 'colonnade' || b.kind === 'gate' || b.kind === 'church') return;
  const seed = (parseInt(b.id.replace(/\D/g, '').slice(-6) || '0', 10) % 997) / 997;
  const grand = b.kind === 'palace' || b.kind === 'public';
  const bay = grand ? 4.0 : 2.9 + 0.6 * seed;
  // the step's faces carry the plinth's stone (the facade draws below 60 cm as stone)
  const fac = [b.eave, b.storey, 1.9, 1 + 128 * SRC_CODE[b.src]];
  const col = hexRGB(b.colour);
  const r = b.outer, n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[2 * i]!, az = r[2 * i + 1]!, bx = r[2 * j]!, bz = r[2 * j + 1]!;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L <= 7) continue;
    const nb = Math.max(1, Math.floor(L / bay));
    if (nb < 3) continue;
    if (det.exposed && !det.exposed(ax, az, bx, bz)) continue;
    const tx = dx / L, tz = dz / L, nx = dz / L, nz = -dx / L;
    const uc = (Math.floor(nb / 2) + 0.5) * (L / nb);
    // (17 cm over the pavement, which stands a kerb's height over the ground the house stands on)
    const W = grand ? 2.6 : 1.9, D = 0.45, H = 0.31, y0 = b.base ?? 0;
    const P = (u: number, o: number, y: number) => [ax + tx * (uc + u) + nx * o, y0 + y, az + tz * (uc + u) + nz * o];
    const quad = (q: number[][], nn: number[], uv: number[][]) => {
      const e1 = [0, 1, 2].map((c) => q[1]![c]! - q[0]![c]!), e2 = [0, 1, 2].map((c) => q[2]![c]! - q[0]![c]!);
      const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const order = cr[0]! * nn[0]! + cr[1]! * nn[1]! + cr[2]! * nn[2]! >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (const k of order) { walls.pos.push(...q[k]!); walls.nrm.push(...nn); walls.uv.push(...uv[k]!); walls.fac.push(...fac); walls.col.push(...col); }
    };
    const h = W / 2;
    quad([P(-h, D, 0), P(h, D, 0), P(h, D, H), P(-h, D, H)], [nx, 0, nz], [[0, 0], [W, 0], [W, H], [0, H]]);
    quad([P(-h, 0, H), P(h, 0, H), P(h, D, H), P(-h, D, H)], [0, 1, 0], [[0, 0.1], [W, 0.1], [W, 0.4], [0, 0.4]]);
    quad([P(-h, 0, 0), P(-h, D, 0), P(-h, D, H), P(-h, 0, H)], [-tx, 0, -tz], [[0, 0], [D, 0], [D, H], [0, H]]);
    quad([P(h, D, 0), P(h, 0, 0), P(h, 0, H), P(h, D, H)], [tx, 0, tz], [[0, 0], [D, 0], [D, H], [0, H]]);
  }
}

/* ── Awnings ───────────────────────────────────────────────────────
   Over the shop windows on the sunny side (fronts facing south to
   west), most shops let down a canvas awning: from under the board
   it slopes 1.4 m out and some 75 cm down, with a valance hanging at
   its front edge. The bays are laid out as the facade shader lays
   them (buildings.ts), so each awning hangs over its window; none
   over the door. Striped in cream and a colour, by the shop. */
const STRIPES: [number, number, number][] = [[0.42, 0.06, 0.04], [0.06, 0.2, 0.09], [0.07, 0.1, 0.25], [0.32, 0.22, 0.08], [0.4, 0.38, 0.33]];
function awnings(b: Building, det: Details) {
  const cloth = det.cloth!;
  if (b.windows === false || (b.base ?? 0) > 0.5) return;
  const seed = (parseInt(b.id.replace(/\D/g, '').slice(-6) || '0', 10) % 997) / 997;
  const r = b.outer, n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[2 * i]!, az = r[2 * i + 1]!, bx = r[2 * j]!, bz = r[2 * j + 1]!;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L <= 4) continue;
    const nx = dz / L, nz = -dx / L;
    // the sunny side: facing south (+z) to west (−x)
    if (!(nz > 0.3 || (nx < -0.6 && nz > -0.3))) continue;
    if (det.exposed && !det.exposed(ax, az, bx, bz)) continue;
    // not every shop: by the wall's own draw
    const k = ((seed * 977 + i * 0.6180339) % 1 + 1) % 1;
    if (k > 0.65) continue;
    const stripe = STRIPES[Math.floor(k / 0.65 * STRIPES.length) % STRIPES.length]!;
    const bay = 2.9 + 0.6 * seed, nb = Math.max(1, Math.floor(L / bay)), bw = L / nb;
    const doorBay = nb >= 3 && L > 7 ? Math.floor(nb / 2) : -1;
    const tx = dx / L, tz = dz / L;
    const sw = Math.min(bw - 0.5, 2.6) + 0.4, out = 1.4, y0 = 0.6 + 2.72, y1 = y0 - 0.75, vh = 0.24;
    for (let bi = 0; bi < nb; bi++) {
      if (bi === doorBay) continue;
      const uc = (bi + 0.5) * bw;
      const P = (u: number, o: number, y: number) => [ax + tx * u + nx * o, y, az + tz * u + nz * o];
      const quad = (q: number[][], nn: number[], uv: number[][]) => {
        for (const kk of [0, 1, 2, 0, 2, 3]) {
          cloth.pos.push(...q[kk]!); cloth.nrm.push(...nn); cloth.uv.push(...uv[kk]!); cloth.col.push(...stripe);
        }
      };
      const sl = Math.hypot(out, y0 - y1);
      const nn = [nx * (y0 - y1) / sl, out / sl, nz * (y0 - y1) / sl];
      const u0 = uc - sw / 2, u1 = uc + sw / 2;
      quad([P(u0, 0.02, y0), P(u1, 0.02, y0), P(u1, out, y1), P(u0, out, y1)], nn, [[0, 0], [sw, 0], [sw, sl], [0, sl]]);
      // the valance, its v running on from the slope's
      quad([P(u0, out, y1), P(u1, out, y1), P(u1, out, y1 - vh), P(u0, out, y1 - vh)], [nx, 0, nz], [[0, sl], [sw, sl], [sw, sl + vh], [0, sl + vh]]);
    }
  }
}

/* ── Eaves ─────────────────────────────────────────────────────────
   Where a roof comes down to a wall, it does not stop at the wall's
   face: the rafters run on some 40 cm (an estimate for the plastered
   box eaves of the 18th and 19th century), the tiles with them at a
   flatter pitch (the kick of the sprocket pieces), boxed in below by
   a soffit and in front by a board under a half-round zinc gutter,
   with downpipes at the ends of the house. Only along walls that are
   eaves over their whole length and stand free: on a party wall the
   neighbour's own eaves carry on. Corners between two such walls are
   mitred; other ends are closed by a small end board. */
const EAVE_O = 0.4, EAVE_F = 0.2, GUTTER_R = 0.075, PIPE_R = 0.05;
function eaves(b: Building, r: Ring, rp: RoofPlan, walls: WallBuf, roofs: RoofBuf, det: Details) {
  if (b.roof === 'flat' || rp.H <= 0.05 || (rp.mode === 'distance' && rp.profile !== 'hip')) return;
  if (b.kind === 'colonnade' || b.kind === 'gate' || (b.base ?? 0) > 2) return;
  const n = r.length / 2;
  if (n < 3) return;
  const f = (x: number, z: number) => rp.mode === 'planes' ? Math.max(0, envelope(rp.planes, x, z)) : 0;
  const col = hexRGB(b.colour), roofCol = hexRGB(b.roofColour);
  // per edge: is it a free eave, its outward normal, its kick (slope of the strip)
  const E = Array.from({ length: n }, (_, i) => {
    const j = (i + 1) % n;
    const ax = r[2 * i]!, az = r[2 * i + 1]!, bx = r[2 * j]!, bz = r[2 * j + 1]!;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    const nx = L > 0 ? dz / L : 0, nz = L > 0 ? -dx / L : 0;
    let ok = L > 1.2;
    let slope = rp.k, plane: Plane | null = null;
    if (ok && rp.mode === 'planes') {
      for (const t of [0.02, 0.5, 0.98]) if (f(ax + dx * t, az + dz * t) > 0.05) ok = false;
      const mx = ax + dx / 2 - nx * 0.4, mz = az + dz / 2 - nz * 0.4;
      slope = f(mx, mz) / 0.4;
      let m = Infinity;
      for (const p of rp.planes) { const v = evalP(p, mx, mz); if (v < m) { m = v; plane = p; } }
      if (slope < 0.15) ok = false;
    }
    const free = L > 0.05 && (!det.exposed || det.exposed(ax, az, bx, bz));
    if (!free) ok = false;
    return { ok, free, ax, az, bx, bz, dx, dz, L, nx, nz, kick: Math.min(slope, 0.85), plane };
  });
  // the outer line's end at the start or end vertex of edge i, at offset o:
  // mitred with the neighbouring edge where that is a free eave too
  const corner = (i: number, side: 'start' | 'end', o: number): [number, number, boolean] => {
    const cur = E[i]!, other = E[side === 'start' ? (i + n - 1) % n : (i + 1) % n]!;
    const vx = side === 'start' ? cur.ax : cur.bx, vz = side === 'start' ? cur.az : cur.bz;
    const dot = cur.nx * other.nx + cur.nz * other.nz;
    if (other.ok && 1 + dot > 0.3) {
      const k = o / (1 + dot);
      return [vx + (cur.nx + other.nx) * k, vz + (cur.nz + other.nz) * k, true];
    }
    return [vx + cur.nx * o, vz + cur.nz * o, false];
  };
  // a quad on the walls' buffer, wound to face nn
  const wq = (P: number[][], nn: number[], uvs: number[][], fac: number[]) => {
    const e1 = [0, 1, 2].map((c) => P[1]![c]! - P[0]![c]!), e2 = [0, 1, 2].map((c) => P[2]![c]! - P[0]![c]!);
    const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const order = cr[0]! * nn[0]! + cr[1]! * nn[1]! + cr[2]! * nn[2]! >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const k of order) {
      walls.pos.push(...P[k]!); walls.nrm.push(...nn); walls.uv.push(...uvs[k]!);
      walls.fac.push(...fac); walls.col.push(col[0], col[1], col[2]);
    }
  };
  const blank = 1 + 128 * SRC_CODE[b.src];
  const metal = det.metal;
  const tube = (pts: number[][], R: number, sides: number, from = 0, to = Math.PI * 2) => {
    // a tube (or a part of one, angles from..to round its axis; on a
    // level axis 0..π is the lower half) through pts
    if (!metal) return;
    for (let s = 1; s < pts.length; s++) {
      const p = pts[s - 1]!, q = pts[s]!;
      const ax = [q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!], al = Math.hypot(ax[0]!, ax[1]!, ax[2]!);
      if (al < 1e-4) continue;
      const a = ax.map((v) => v / al);
      const ref = Math.abs(a[1]!) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let u = [a[1]! * ref[2]! - a[2]! * ref[1]!, a[2]! * ref[0]! - a[0]! * ref[2]!, a[0]! * ref[1]! - a[1]! * ref[0]!];
      const ul = Math.hypot(u[0]!, u[1]!, u[2]!); u = u.map((v) => v / ul);
      const w = [a[1]! * u[2]! - a[2]! * u[1]!, a[2]! * u[0]! - a[0]! * u[2]!, a[0]! * u[1]! - a[1]! * u[0]!];
      for (let k = 0; k < sides; k++) {
        const t0 = from + (to - from) * k / sides, t1 = from + (to - from) * (k + 1) / sides;
        const d0 = [0, 1, 2].map((c) => u[c]! * Math.cos(t0) + w[c]! * Math.sin(t0)), d1 = [0, 1, 2].map((c) => u[c]! * Math.cos(t1) + w[c]! * Math.sin(t1));
        const v = (base: number[], d: number[]) => [base[0]! + d[0]! * R, base[1]! + d[1]! * R, base[2]! + d[2]! * R];
        for (const [base, d] of [[p, d0], [q, d1], [q, d0], [p, d0], [p, d1], [q, d1]] as const) { metal.pos.push(...v(base, d)); metal.nrm.push(...d); }
      }
    }
  };
  const yb = b.base ?? 0;
  for (let i = 0; i < n; i++) {
    const e = E[i]!;
    if (!e.ok) continue;
    const yo = b.eave - e.kick * EAVE_O, yf = yo - EAVE_F;
    const [sx, sz, sm] = corner(i, 'start', EAVE_O), [ex, ez, em] = corner(i, 'end', EAVE_O);
    // the strip of tiles, continuing the roof's texture coordinates
    const P = [[e.ax, b.eave, e.az], [e.bx, b.eave, e.bz], [ex, yo, ez], [sx, yo, sz]];
    const sl = Math.hypot(1, e.kick), vo = -EAVE_O * sl;
    let uvs: number[][];
    if (e.plane) {
      const pl = e.plane, gl = Math.hypot(pl[1], pl[2]);
      const tx = -pl[2] / gl, tz = pl[1] / gl;
      uvs = P.map(([x, , z], k) => [x! * tx + z! * tz, k < 2 ? 0 : vo]);
    } else uvs = P.map(([x, , z], k) => [x! + z!, k < 2 ? 0 : vo]);
    const rn = [e.nx * e.kick / sl, 1 / sl, e.nz * e.kick / sl];
    pushTri(roofs, [...P[0]!, ...P[1]!, ...P[2]!], rn[0]!, rn[1]!, rn[2]!, [...uvs[0]!, ...uvs[1]!, ...uvs[2]!], roofCol);
    pushTri(roofs, [...P[0]!, ...P[2]!, ...P[3]!], rn[0]!, rn[1]!, rn[2]!, [...uvs[0]!, ...uvs[2]!, ...uvs[3]!], roofCol);
    // the board in front (drawn as cornice: its eave is its top) and the soffit under it
    const fac = [yo, b.storey, e.L, blank];
    const ue = (x: number, z: number) => ((x - e.ax) * e.dx + (z - e.az) * e.dz) / e.L;
    const front = [[sx, yf, sz], [ex, yf, ez], [ex, yo, ez], [sx, yo, sz]];
    wq(front, [e.nx, 0, e.nz], front.map(([x, y, z]) => [ue(x!, z!), y!]), fac);
    const soffit = [[e.bx, yf, e.bz], [e.ax, yf, e.az], [sx, yf, sz], [ex, yf, ez]];
    wq(soffit, [0, -1, 0], soffit.map(([x, , z]) => [ue(x!, z!), yf - (((x! - e.ax) * e.nx + (z! - e.az) * e.nz))]), [1000, b.storey, e.L, blank]);
    // end boards where the eave does not turn a corner
    const tx = e.dx / e.L, tz = e.dz / e.L;
    if (!sm) {
      const cap = [[e.ax, yf, e.az], [sx, yf, sz], [sx, yo, sz], [e.ax, b.eave, e.az]];
      wq(cap, [-tx, 0, -tz], cap.map(([x, y, z]) => [(x! - e.ax) * e.nx + (z! - e.az) * e.nz, y!]), fac);
    }
    if (!em) {
      const cap = [[ex, yf, ez], [e.bx, yf, e.bz], [e.bx, b.eave, e.bz], [ex, yo, ez]];
      wq(cap, [tx, 0, tz], cap.map(([x, y, z]) => [(x! - e.ax) * e.nx + (z! - e.az) * e.nz, y!]), fac);
    }
    if (!metal) continue;
    // the gutter: a half-round under the tiles' edge, open at the top
    const [gsx, gsz] = corner(i, 'start', EAVE_O + GUTTER_R), [gex, gez] = corner(i, 'end', EAVE_O + GUTTER_R);
    const gy = yo - GUTTER_R * 0.6;
    tube([[gsx, gy, gsz], [gex, gy, gez]], GUTTER_R, 5, 0, Math.PI);
    // downpipes: at the ends of the house (one per corner), and every 15 m or so on a long front
    // (one at each corner; at a party wall the house to its left has it)
    const at: number[] = [];
    if (sm || E[(i + n - 1) % n]!.free) at.push(0.3);
    if (!em) at.push(e.L - 0.3);
    const mid = Math.floor(e.L / 15);
    for (let k = 1; k <= mid; k++) at.push(e.L * k / (mid + 1));
    for (const s of at) {
      if (s < 0.25 || s > e.L - 0.25) continue;
      const px = e.ax + tx * s, pz = e.az + tz * s;
      const off = 0.06 + PIPE_R;
      const g = [px + e.nx * (EAVE_O + GUTTER_R), gy - GUTTER_R * 0.5, pz + e.nz * (EAVE_O + GUTTER_R)];
      const bend = [px + e.nx * off, gy - 0.6, pz + e.nz * off];
      tube([g, [g[0]!, g[1]! - 0.15, g[2]!], bend, [bend[0]!, yb + 0.25, bend[2]!], [px + e.nx * (off + 0.18), yb + 0.06, pz + e.nz * (off + 0.18)]], PIPE_R, 5);
    }
  }
}

/* Chimneys: one per 9 m of ridge or so, on the ridge line a little to
   either side, plastered stacks with a flat cap, a metre above the
   ridge. Each is a small blank building whose walls start just below
   the roof surface. */
function chimneys(b: Building, rp: RoofPlan, walls: WallBuf, roofs: RoofBuf) {
  if (rp.mode !== 'planes' || !rp.box || rp.H < 2 || (b.kind && b.kind !== 'house') || b.windows === false) return;
  const { cx, cz, ang, A } = rp.box;
  const c = Math.cos(ang), s = Math.sin(ang);
  let seed = 0;
  for (let i = 0; i < b.id.length; i++) seed = (seed * 31 + b.id.charCodeAt(i)) >>> 0;
  const n = Math.max(1, Math.round(2 * A / 9));
  for (let k = 0; k < n; k++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const u = -A + (2 * A) * (k + 0.5) / n + ((seed >>> 8) % 100 - 50) / 100 * 1.2;
    const v = (((seed >>> 16) % 100) / 100 - 0.5) * 1.4;
    const w = 0.55, d = 0.8;
    const pts: number[] = [];
    let lo = Infinity, hi = -Infinity;
    for (const [du, dv] of [[-d, -w], [d, -w], [d, w], [-d, w]] as const) {
      const x = cx + (u + du / 2) * c - (v + dv / 2) * s, z = cz + (u + du / 2) * s + (v + dv / 2) * c;
      pts.push(x, z);
      const y = b.eave + Math.max(0, envelope(rp.planes, x, z));
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    if (!pts.every((_, i) => i % 2 || insideRing(b.outer, pts[i]!, pts[i + 1]!))) continue;
    const stack: Building = {
      id: b.id + 'c' + k, src: b.src, outer: pts, base: lo - 0.2, eave: Math.max(hi, b.eave + rp.H) + 0.9, roofH: 0, roof: 'flat',
      storey: 3, colour: b.wall === 'brick' ? b.colour : '#8f857a', roofColour: '#5a5450', windows: false, wall: 'brick',
    };
    const flat = roofPlanes(stack);
    const ring = orient(pts, true);
    ringWalls(stack, ring, flat, walls);
    roofFaces({ ...stack, outer: ring }, flat, roofs, stack.eave);
  }
}

/* ── Dormers ───────────────────────────────────────────────────────
   Townhouses' gable and mansard roofs carry a row of dormers along
   each long side, one about every 3.5 m: a front wall with a window
   set a little back from the eaves, two triangular cheeks, and a
   small gable roof that runs back until it meets the main roof. The
   main roof is not cut — the dormer stands on it, which from the
   street is the same. */
const DW = 1.5, DH = 1.6;   // dormer width, front wall height (m)
function dormers(b: Building, rp: RoofPlan, walls: WallBuf, roofs: RoofBuf) {
  if (rp.mode !== 'planes' || !rp.box || (b.roof !== 'gabled' && b.roof !== 'mansard' && b.roof !== 'hipped' && b.roof !== 'half-hipped')) return;
  if ((b.kind && b.kind !== 'house') || b.wall === 'copper' || rp.H < 3.2 || b.windows === false) return;
  if (b.wall === 'brick') { dutchGables(b, rp, walls); return; }
  const { cx, cz, ang, A, B } = rp.box;
  if (A < 4 || B < 4) return;
  const c = Math.cos(ang), s = Math.sin(ang);
  const W = (u: number, v: number): [number, number] => [cx + u * c - v * s, cz + u * s + v * c];
  const f = (u: number, v: number) => { const [x, z] = W(u, v); return Math.max(0, envelope(rp.planes, x, z)); };
  const wallCol = hexRGB(b.colour), roofCol = hexRGB(b.roofColour);
  // only where the outline really is the rectangle's long side
  const onOutline = (u: number, v: number) => { const [x, z] = W(u, v); return insideRing(b.outer, x, z); };
  const n = Math.floor((2 * A - (b.roof === 'gabled' || b.roof === 'mansard' ? 2.5 : 2 * B)) / 3.6);
  if (n < 1) return;
  const span = n * 3.6;
  for (const sg of [1, -1]) {
    // set back from the eave to where the roof is 0.5 m up (on a mansard, on the steep part)
    let back = 0.25;
    while (back < B * 0.5 && f(0, sg * (B - back)) < 0.5) back += 0.05;
    for (let i = 0; i < n; i++) {
      const u = -span / 2 + 1.8 + i * 3.6;
      const vf = sg * (B - back);
      if (!onOutline(u - DW / 2, sg * (B - 0.1)) || !onOutline(u + DW / 2, sg * (B - 0.1))) continue;
      const y0 = b.eave + f(u, vf), y1 = y0 + DH, yr = y1 + DW * 0.4;
      // how far back the main roof reaches a height
      const reach = (y: number) => { let d = 0; while (d < B && b.eave + f(u, vf - sg * d) < y) d += 0.05; return d; };
      const d1 = reach(y1), dr = reach(yr);
      if (back + dr > B - 0.2) continue;   // too flat a roof for a dormer this tall
      const P = (du: number, dv: number, y: number): number[] => { const [x, z] = W(u + du, vf - sg * dv); return [x, y, z]; };
      const [nx, nz] = [-s * sg, c * sg];   // outward
      // front wall and its gable
      const fl = P(-DW / 2, 0, y0), fr = P(DW / 2, 0, y0), tl = P(-DW / 2, 0, y1), tr = P(DW / 2, 0, y1), tg = P(0, 0, yr);
      const fac = [y1, y0, DW, 32 + (b.windows === false ? 1 : 0) + 128 * SRC_CODE[b.src]];
      const wtri = (a: number[], bb: number[], cc: number[], ua: number[], ub: number[], uc: number[], nn: number[]) => {
        const e1 = [bb[0]! - a[0]!, bb[1]! - a[1]!, bb[2]! - a[2]!], e2 = [cc[0]! - a[0]!, cc[1]! - a[1]!, cc[2]! - a[2]!];
        const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
        const flip = cr[0]! * nn[0]! + cr[1]! * nn[1]! + cr[2]! * nn[2]! < 0;
        const vs = flip ? [[a, ua], [cc, uc], [bb, ub]] : [[a, ua], [bb, ub], [cc, uc]];
        for (const [p, q] of vs) {
          walls.pos.push(p![0]!, p![1]!, p![2]!); walls.nrm.push(nn[0]!, nn[1]!, nn[2]!); walls.uv.push(q![0]!, q![1]!);
          walls.fac.push(...fac); walls.col.push(wallCol[0], wallCol[1], wallCol[2]);
        }
      };
      const out = [nx, 0, nz];
      wtri(fl, fr, tr, [0, y0], [DW, y0], [DW, y1], out);
      wtri(fl, tr, tl, [0, y0], [DW, y1], [0, y1], out);
      wtri(tl, tr, tg, [0, y1], [DW, y1], [DW / 2, yr], out);
      // cheeks
      const bl = P(-DW / 2, d1, y1), br = P(DW / 2, d1, y1);
      wtri(fl, tl, bl, [0, y0], [0, y1], [d1, y1], [-c, 0, -s]);
      wtri(fr, br, tr, [0, y0], [d1, y1], [0, y1], [c, 0, s]);
      // the dormer's roof, a little proud of its walls
      const o = 0.15;
      const el = P(-DW / 2 - o, -o, y1 - o * 0.8), er = P(DW / 2 + o, -o, y1 - o * 0.8), rg = P(0, -o, yr + 0.05);
      const bl2 = P(-DW / 2 - o, d1, y1 - o * 0.8), br2 = P(DW / 2 + o, d1, y1 - o * 0.8), rg2 = P(0, dr, yr + 0.05);
      const rq = (a: number[], bb: number[], cc: number[], d: number[]) => {
        const e1 = [bb[0]! - a[0]!, bb[1]! - a[1]!, bb[2]! - a[2]!], e2 = [d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!];
        let nn = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
        if (nn[1]! < 0) nn = nn.map((v) => -v);
        const l = Math.hypot(nn[0]!, nn[1]!, nn[2]!) || 1;
        pushTri(roofs, [...a, ...bb, ...cc], nn[0]! / l, nn[1]! / l, nn[2]! / l, [0, 0, 1, 0, 1, 1], roofCol);
        pushTri(roofs, [...a, ...cc, ...d], nn[0]! / l, nn[1]! / l, nn[2]! / l, [0, 0, 1, 1, 0, 1], roofCol);
      };
      rq(el, rg, rg2, bl2);
      rq(rg, er, br2, rg2);
    }
  }
}

/* ── Dutch gables ─────────────────────────────────────────────────
   The houses of the Dutch Quarter (1734–42) carry, instead of
   dormers, a gable in the middle of each long side that rises flush
   from the facade to near the ridge, its outline a bell: straight
   cheeks, a concave then convex sweep, a small cap. Built as a wall
   (earcut over its outline, brick by the facade shader) standing
   before the main roof's slope. */
function dutchGables(b: Building, rp: RoofPlan, walls: WallBuf) {
  const { cx, cz, ang, A, B } = rp.box!;
  if (2 * A < 6.5) return;
  const c = Math.cos(ang), s = Math.sin(ang);
  const wallCol = hexRGB(b.colour);
  const top = b.eave + rp.H - 0.6;           // the cap stands a little below the ridge
  const w = Math.min(3.6, 2 * A * 0.4);
  // the outline, in (across, up) from the gable's foot at the eave
  const H = top - b.eave, prof: [number, number][] = [];
  const N = 10;
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    // half-width shrinks from w/2 to 0.35 m along a bell
    const hw = 0.35 + (w / 2 - 0.35) * (1 - (3 * t * t - 2 * t * t * t)) + 0.12 * Math.sin(t * Math.PI * 2) * (1 - t);
    prof.push([hw, t * H]);
  }
  for (const sg of [1, -1]) {
    const v = sg * B;
    const P = (du: number, y: number, dv = 0): number[] => [cx + du * c - (v - sg * dv) * s, y, cz + du * s + (v - sg * dv) * c];
    // must stand on the real outline there
    const foot = P(0, 0), mx = foot[0]!, mz = foot[2]!;
    if (!insideRing(b.outer, mx - (-s) * sg * 0.3, mz - c * sg * 0.3)) continue;
    const outline: number[][] = [];
    for (const [hw, y] of prof) outline.push([hw, b.eave + y]);
    for (let k = prof.length - 1; k >= 0; k--) outline.push([-prof[k]![0], b.eave + prof[k]![1]]);
    outline.push([-w / 2, b.eave - 0.01], [w / 2, b.eave - 0.01]);
    const flat2 = outline.flatMap(([u, y]) => [u!, y!]);
    const tris = earcut(flat2, null, 2);
    const nx = -s * sg, nz = c * sg;
    const fac = [top + 0.2, b.storey, w, 8 + 128 * SRC_CODE[b.src]];   // brick, its windows in the rows of the storeys below
    for (let t = 0; t < tris.length; t += 3) {
      const pts = [tris[t]!, tris[t + 1]!, tris[t + 2]!].map((k) => P(flat2[2 * k]!, flat2[2 * k + 1]!, 0.02));
      const e1 = [pts[1]![0]! - pts[0]![0]!, pts[1]![1]! - pts[0]![1]!, pts[1]![2]! - pts[0]![2]!], e2 = [pts[2]![0]! - pts[0]![0]!, pts[2]![1]! - pts[0]![1]!, pts[2]![2]! - pts[0]![2]!];
      const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const order = cr[0]! * nx + cr[2]! * nz >= 0 ? [0, 1, 2] : [0, 2, 1];
      for (const q of order) {
        const p = pts[q]!;
        const u = (p[0]! - cx) * c + (p[2]! - cz) * s;
        walls.pos.push(p[0]!, p[1]!, p[2]!); walls.nrm.push(nx, 0, nz); walls.uv.push(u + 50, p[1]!);
        walls.fac.push(...fac); walls.col.push(wallCol[0], wallCol[1], wallCol[2]);
      }
    }
  }
}

function insideRing(r: Ring, x: number, z: number) {
  let cIn = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i]!, zi = r[i + 1]!, xj = r[j]!, zj = r[j + 1]!;
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) cIn = !cIn;
  }
  return cIn;
}

/* The roof's height above the eaves at a point, for tests and probes;
   roofFn plans the roof once for many points (city/skyview.ts). */
export function roofFn(b: Building): (x: number, z: number) => number {
  const rp = roofPlanes(b);
  if (rp.mode === 'planes') return (x, z) => Math.max(0, envelope(rp.planes, x, z));
  const rings = [b.outer, ...(b.holes ?? [])];
  return (x, z) => distanceLift(rp, boundaryDist(rings, x, z));
}
export function roofAt(b: Building, x: number, z: number) {
  return roofFn(b)(x, z);
}
