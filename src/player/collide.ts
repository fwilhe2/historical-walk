/* ── Collision: walls as segments in a grid ─────────────────────
   Every building outline (and courtyard), the city wall and the
   garden walls become segments, binned on a 4 m grid. The walker is
   a circle; it is pushed out of every segment it overlaps, a few
   times over, which slides it along walls and into corners without
   sticking. Pure: no three. */
import type { City } from '../city/types';

const CELL = 4;
export interface Segs { cells: Map<number, number[]>; seg: Float32Array }

const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

export function buildSegs(city: City): Segs {
  const s: number[] = [];
  const ring = (r: number[], closed: boolean) => {
    const n = r.length;
    for (let i = closed ? 0 : 2; i < n; i += 2) {
      const j = i === 0 ? n - 2 : i - 2;
      s.push(r[j]!, r[j + 1]!, r[i]!, r[i + 1]!);
    }
  };
  for (const b of city.buildings) {
    if ((b.base ?? 0) > 2.2) continue;   // you walk under arcades and gate passages
    ring(b.outer, true);
    for (const h of b.holes ?? []) ring(h, true);
  }
  for (const w of city.walls) ring(w.pts, false);
  for (const f of city.fixtures) { const r = f.kind === 'column' ? 0.7 : 0.25; ring([f.x - r, f.z - r, f.x + r, f.z - r, f.x + r, f.z + r, f.x - r, f.z + r], true); }
  for (const l of city.lamps) ring([l.x - 0.15, l.z - 0.15, l.x + 0.15, l.z - 0.15, l.x + 0.15, l.z + 0.15, l.x - 0.15, l.z + 0.15], true);
  // columns as small squares
  for (const c of city.columns) {
    if (c.base > 1) continue;
    const r = c.r * 1.2;
    ring([c.x - r, c.z - r, c.x + r, c.z - r, c.x + r, c.z + r, c.x - r, c.z + r], true);
  }
  const seg = new Float32Array(s);
  const cells = new Map<number, number[]>();
  for (let k = 0; k < seg.length; k += 4) {
    const ax = seg[k]!, az = seg[k + 1]!, bx = seg[k + 2]!, bz = seg[k + 3]!;
    const i0 = Math.floor(Math.min(ax, bx) / CELL), i1 = Math.floor(Math.max(ax, bx) / CELL);
    const j0 = Math.floor(Math.min(az, bz) / CELL), j1 = Math.floor(Math.max(az, bz) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const c = key(i, j);
      let l = cells.get(c);
      if (!l) cells.set(c, (l = []));
      l.push(k);
    }
  }
  return { cells, seg };
}

/* Push a circle at (x, z) of radius r out of every segment it
   touches; returns the corrected position. */
export function pushOut(S: Segs, x: number, z: number, r: number): [number, number] {
  for (let it = 0; it < 4; it++) {
    let moved = false;
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    const seen = new Set<number>();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = S.cells.get(key(i, j));
      if (!l) continue;
      for (const k of l) {
        if (seen.has(k)) continue;
        seen.add(k);
        const ax = S.seg[k]!, az = S.seg[k + 1]!, bx = S.seg[k + 2]!, bz = S.seg[k + 3]!;
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
        let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + t * dx, pz = az + t * dz;
        let ex = x - px, ez = z - pz;
        const d2 = ex * ex + ez * ez;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-6) { ex = -dz; ez = dx; const l2 = Math.hypot(ex, ez) || 1; ex /= l2; ez /= l2; }
        else { ex /= d; ez /= d; }
        x = px + ex * r; z = pz + ez * r;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return [x, z];
}
