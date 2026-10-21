/* ── Sky view ───────────────────────────────────────────────────
   How much of the sky a wall or the ground sees, from the town's own
   massing: in a street the houses opposite hide the lower sky, so the
   lower storeys and the pavement get less of its light (and more of
   what the sunlit fronts throw back) than the eaves and the middle of
   a square. Pure (no three), run once at load:

     heightField   every footprint rasterised at a metre a cell, each
                   cell the height of its roof there
     wallSky       for a point on a wall (its outward normal level),
                   the cosine-weighted share of the open sky's light
                   it still gets: 1 free, 0 walled in
     groundSky     the same for level ground, on a coarser raster

   The horizon in each direction is the steepest rise to a roof along
   it, marched out to 150 m in growing steps. Distant hills and trees
   are not counted. */
import { bbox } from '../geom/poly';
import { roofFn } from './massing';
import type { Building } from './types';

export interface HeightField { x0: number; z0: number; cell: number; nx: number; nz: number; h: Float32Array }

export function heightField(list: Building[], bounds: readonly [number, number, number, number], cell = 1): HeightField {
  const [x0, z0, x1, z1] = bounds;
  const nx = Math.ceil((x1 - x0) / cell), nz = Math.ceil((z1 - z0) / cell);
  const h = new Float32Array(nx * nz);
  for (const b of list) {
    if ((b.base ?? 0) > 2) continue;   // a gateway's upper storey leaves the passage open
    const roof = roofFn(b);
    const [bx0, bz0, bx1, bz1] = bbox(b.outer);
    const i0 = Math.max(0, Math.floor((bx0 - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((bx1 - x0) / cell));
    const j0 = Math.max(0, Math.floor((bz0 - z0) / cell)), j1 = Math.min(nz - 1, Math.floor((bz1 - z0) / cell));
    const rings = [b.outer, ...(b.holes ?? [])];
    for (let j = j0; j <= j1; j++) {
      const z = z0 + (j + 0.5) * cell;
      // the row's crossings with every ring, for an even-odd scan
      const xs: number[] = [];
      for (const r of rings) {
        for (let i = 0, k = r.length - 2; i < r.length; k = i, i += 2) {
          const za = r[k + 1]!, zb = r[i + 1]!;
          if ((za > z) !== (zb > z)) xs.push(r[k]! + (z - za) / (zb - za) * (r[i]! - r[k]!));
        }
      }
      xs.sort((a, b2) => a - b2);
      for (let s = 0; s + 1 < xs.length; s += 2) {
        const a = Math.max(i0, Math.ceil((xs[s]! - x0) / cell - 0.5)), e = Math.min(i1, Math.floor((xs[s + 1]! - x0) / cell - 0.5));
        for (let i = a; i <= e; i++) {
          const y = b.eave + roof(x0 + (i + 0.5) * cell, z);
          const n = j * nx + i;
          if (y > h[n]!) h[n] = y;
        }
      }
    }
  }
  return { x0, z0, cell, nx, nz, h };
}

const STEPS = [0.7, 1.2, 1.8, 2.6, 3.6, 5, 7, 9.5, 13, 18, 25, 34, 46, 62, 84, 112, 150];

function heightAtCell(f: HeightField, x: number, z: number) {
  const i = Math.floor((x - f.x0) / f.cell), j = Math.floor((z - f.z0) / f.cell);
  if (i < 0 || j < 0 || i >= f.nx || j >= f.nz) return 0;
  return f.h[j * f.nx + i]!;
}

/* The tangent of the horizon's elevation from (x, y, z) looking along
   the level direction (dx, dz). */
export function horizon(f: HeightField, x: number, z: number, y: number, dx: number, dz: number) {
  let t = 0;
  for (const r of STEPS) {
    const h = heightAtCell(f, x + dx * r, z + dz * r) - y;
    if (h > 0 && h / r > t) t = h / r;
  }
  return t;
}

// azimuths round the wall's normal, and their cosine weights
const WALL_AZ = [-75, -50, -25, 0, 25, 50, 75].map((d) => d * Math.PI / 180);
const WALL_W = (() => { const w = WALL_AZ.map(Math.cos); const s = w.reduce((a, b) => a + b, 0); return w.map((v) => v / s); })();

/* A wall: the share of its upper half-hemisphere's cosine-weighted
   sky left above the horizon. With the horizon at θ in a direction,
   the open part is ∫θ^π/2 cos²e de = π/4 − θ/2 − sin 2θ / 4, of π/4. */
export function wallSky(f: HeightField, x: number, z: number, nx: number, nz: number, y: number) {
  // start a little out from the wall, so it does not see itself
  const px = x + nx * 0.6, pz = z + nz * 0.6;
  let v = 0;
  for (let k = 0; k < WALL_AZ.length; k++) {
    const a = WALL_AZ[k]!, c = Math.cos(a), s = Math.sin(a);
    const dx = nx * c - nz * s, dz = nz * c + nx * s;
    const th = Math.atan(horizon(f, px, pz, y, dx, dz));
    v += WALL_W[k]! * (1 - (2 * th + Math.sin(2 * th)) / Math.PI);
  }
  return v;
}

/* Level ground: with the horizon at θ, the open part is cos²θ. (For
   tests and probes: the whole raster is drawn on the GPU by the same
   rule, GROUND_SKY_GLSL.) */
export function groundSkyAt(f: HeightField, x: number, z: number, y = 0.3) {
  let v = 0;
  for (let k = 0; k < GROUND_AZ; k++) {
    const a = (k + 0.5) / GROUND_AZ * Math.PI * 2;
    const t = horizon(f, x, z, y, Math.cos(a), Math.sin(a));
    v += 1 / (1 + t * t);
  }
  return v / GROUND_AZ;
}

const GROUND_AZ = 16;
/* The fragment shader for the ground's raster: tH the height field
   (one float a cell, nearest), uF its origin and size in metres, vUv
   the output texel. Writes the open share in r. */
export const GROUND_SKY_GLSL = /* glsl */ `
precision highp float;
uniform sampler2D tH;
uniform vec4 uF;
varying vec2 vUv;
const float STEPS[${STEPS.length}] = float[](${STEPS.map((v) => v.toFixed(2)).join(', ')});
void main() {
  vec2 p = uF.xy + vUv * uF.zw;
  float v = 0.0;
  // the raster's texel holds a roof: value never seen, kept mid-grey
  if (texture2D(tH, vUv).r > 0.5) { gl_FragColor = vec4(0.63, 0.0, 0.0, 1.0); return; }
  for (int k = 0; k < ${GROUND_AZ}; k++) {
    float a = (float(k) + 0.5) / ${GROUND_AZ.toFixed(1)} * 6.2831853;
    vec2 d = vec2(cos(a), sin(a));
    float t = 0.0;
    for (int s = 0; s < ${STEPS.length}; s++) {
      float r = STEPS[s];
      float h = texture2D(tH, (p + d * r - uF.xy) / uF.zw).r - 0.3;
      t = max(t, h / r);
    }
    v += 1.0 / (1.0 + t * t);
  }
  gl_FragColor = vec4(v / ${GROUND_AZ.toFixed(1)}, 0.0, 0.0, 1.0);
}`;
