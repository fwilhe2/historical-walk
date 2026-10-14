/* ── The built-up area of a historical map ─────────────────────
   The Messtischblatt hatches every built-up block, houses and yards
   alike, and leaves streets, squares and parks white (parks with
   scattered tree symbols). So the local density of ink tells built
   from open: blur the darkness over a few metres, threshold it, close
   the speckle the hatching leaves, and open away thin lines (street
   edges, avenue dots, lettering strokes). What is left is the town's
   blocks of 1903, georeferenced by the WMS request itself.

   Pixels map linearly to lat/lon (EPSG:4326 request) and so to the
   local frame (an equirectangular projection), which is why the map
   needs no warping. */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

export interface Mask {
  w: number; h: number;
  bits: Uint8Array;          // 1 = built-up in the map
  x0: number; z0: number;    // local coordinates of the top-left corner
  px: number; pz: number;    // metres per pixel in x and z
  at(x: number, z: number): boolean;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n;
      s += src[y * w + Math.min(w - 1, x + r + 1)]! - src[y * w + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

// Square min (erode) or max (dilate) filter of side 2r+1, separably.
function morph(src: Uint8Array, w: number, h: number, r: number, max: boolean) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const pick = max ? (a: number, b: number) => a | b : (a: number, b: number) => a & b;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = max ? 0 : 1;
    for (let k = -r; k <= r; k++) v = pick(v, src[y * w + Math.min(w - 1, Math.max(0, x + k))]!);
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = max ? 0 : 1;
    for (let k = -r; k <= r; k++) v = pick(v, tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]!);
    out[y * w + x] = v;
  }
  return out;
}

export function loadMask(path: string, corner: [number, number], far: [number, number]): Mask {
  const png = PNG.sync.read(readFileSync(path));
  const { width: w, height: h } = png;
  const ink = new Float32Array(w * h);
  // pngjs always hands back RGBA
  for (let i = 0; i < w * h; i++) ink[i] = 1 - png.data[4 * i]! / 255;
  const blur = boxBlur(ink, w, h, 3);
  let bits = new Uint8Array(w * h);
  // Hatching is about half ink; solid black is lettering (and a few
  // public buildings drawn solid, which the map data has anyway).
  for (let i = 0; i < w * h; i++) bits[i] = blur[i]! > 100 / 255 && blur[i]! < 0.9 ? 1 : 0;
  bits = morph(morph(bits, w, h, 2, true), w, h, 2, false);   // close
  bits = morph(morph(bits, w, h, 3, false), w, h, 3, true);   // open
  const [x0, z0] = corner, [x1, z1] = far;
  const px = (x1 - x0) / w, pz = (z1 - z0) / h;
  return {
    w, h, bits, x0, z0, px, pz,
    at(x, z) {
      const i = Math.floor((x - x0) / px), j = Math.floor((z - z0) / pz);
      return i >= 0 && j >= 0 && i < w && j < h && bits[j * w + i] === 1;
    },
  };
}

/* Share of a ring's area inside the mask, by sampling a grid of
   points over its bounding box at about a metre. */
export function maskShare(m: Mask, ring: number[]): number {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i]!); x1 = Math.max(x1, ring[i]!);
    z0 = Math.min(z0, ring[i + 1]!); z1 = Math.max(z1, ring[i + 1]!);
  }
  const step = Math.max(0.8, Math.min(x1 - x0, z1 - z0) / 6);
  let n = 0, k = 0;
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
    if (!insideRing(ring, x, z)) continue;
    n++;
    if (m.at(x, z)) k++;
  }
  return n ? k / n : 0;
}

function insideRing(r: number[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i]!, zi = r[i + 1]!, xj = r[j]!, zj = r[j + 1]!;
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/* The outlines of the mask's blocks: connected components (4-way),
   each traced round its outer edge along pixel corners, in local
   coordinates. Blocks smaller than minArea m² are skipped. */
export function blockOutlines(m: Mask, minArea: number): number[][] {
  const { w, h, bits } = m;
  const label = new Int32Array(w * h).fill(-1);
  const out: number[][] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!bits[start] || label[start] !== -1) continue;
    // flood fill to count and label
    let count = 0, top = start;
    stack.push(start); label[start] = start;
    while (stack.length) {
      const p = stack.pop()!;
      count++;
      if (p < top) top = p;
      const x = p % w, y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && bits[q] && label[q] === -1) { label[q] = start; stack.push(q); }
    }
    if (count * m.px * m.pz < minArea) continue;
    out.push(trace(m, label, start, top));
  }
  return out;
}

/* Walk the outer boundary of the component with label id, starting
   at the top-left corner of its first pixel (in scan order, so its
   top edge is on the boundary), keeping the inside on the right. */
function trace(m: Mask, label: Int32Array, id: number, first: number): number[] {
  const { w, h } = m;
  const In = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === id;
  // corner coordinates (cx, cy) in pixel-corner space; direction 0 E 1 S 2 W 3 N
  let cx = first % w, cy = (first / w) | 0, d = 0;
  const sx = cx, sy = cy;
  const pts: number[] = [];
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  let guard = 0;
  do {
    pts.push(m.x0 + cx * m.px, m.z0 + cy * m.pz);
    // the two pixels ahead: left-ahead and right-ahead of the edge
    for (let turn = 0; turn < 4; turn++) {
      // pixel to the right of travelling direction d from corner (cx, cy)
      const rx = d === 0 ? cx : d === 1 ? cx - 1 : d === 2 ? cx - 1 : cx;
      const ry = d === 0 ? cy : d === 1 ? cy : d === 2 ? cy - 1 : cy - 1;
      const lx = d === 0 ? cx : d === 1 ? cx : d === 2 ? cx - 1 : cx - 1;
      const ly = d === 0 ? cy - 1 : d === 1 ? cy : d === 2 ? cy : cy - 1;
      const right = In(rx, ry), left = In(lx, ly);
      if (right && !left) break;              // edge with inside on the right: go
      if (right && left) d = (d + 3) % 4;     // blocked by inside: turn left
      else d = (d + 1) % 4;                   // nothing on the right: turn right
    }
    cx += DX[d]!; cy += DY[d]!;
  } while ((cx !== sx || cy !== sy) && ++guard < 4 * w * h);
  return pts;
}
