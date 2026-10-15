/* ── Where to stand to see a landmark ───────────────────────────
   A point on a street (not a footpath), far enough off to see the
   landmark whole, from which as much of it as possible can be seen:
   sight lines from the eye to a third, two thirds and nine tenths of
   its height, clear of other buildings and of tree crowns. The best
   seeing wins, then the nearest. Used by G, the tour and the probe. */
import { bbox, inside } from '../geom/poly';
import type { City, Label } from '../city/types';

export function viewpoint(city: City, l: Label) {
    // candidates: street points far enough off, nearest first
    const minD = Math.max((l.r ?? 15) + 15, (l.h ?? 0) * 0.9);
    const cands: [number, number, number][] = [];
    for (const s of city.streets) {
      if (s.kind === 'path') continue;
      const p = s.pts;
      for (let i = 2; i < p.length; i += 2) {
        const L = Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!), n = Math.max(1, Math.ceil(L / 4));
        for (let k = 0; k <= n; k++) {
          const x = p[i - 2]! + (p[i]! - p[i - 2]!) * k / n, z = p[i - 1]! + (p[i + 1]! - p[i - 1]!) * k / n;
          const d = Math.hypot(x - l.x, z - l.z);
          if (d >= minD && d < minD + 150) cands.push([x, z, d]);
        }
      }
    }
    cands.sort((a, b) => a[2] - b[2]);
    // each candidate scores by how much of the landmark it sees: sight
    // lines from the eye to a third, two thirds and nine tenths of its
    // height, each clear of other buildings and of tree crowns; the
    // best seeing and then the nearest wins
    const own = (b: City['buildings'][number]) => b.name === l.text || inside(b.outer, l.x, l.z);
    const reach = minD + 160;
    const blockers = city.buildings.filter((b) => (b.base ?? 0) < 2 && !own(b))
      .map((b) => ({ r: b.outer, box: bbox(b.outer), top: b.eave + b.roofH }))
      .filter(({ box }) => box[2] > l.x - reach && box[0] < l.x + reach && box[3] > l.z - reach && box[1] < l.z + reach);
    const trees = city.trees.filter((t) => Math.abs(t.x - l.x) < reach && Math.abs(t.z - l.z) < reach);
    const hit = (x: number, z: number, y: number) => blockers.some(({ r, box, top }) => top > y && x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3] && inside(r, x, z))
      || trees.some((t) => t.h > y && t.h * 0.42 < y + 1 && (t.x - x) ** 2 + (t.z - z) ** 2 < t.r * t.r);
    const H = Math.max(6, l.h ?? 10);
    const sees = (x: number, z: number) => {
      if (hit(x, z, 0)) return -1;
      const d = Math.hypot(l.x - x, l.z - z), stop = d - (l.r ?? 15) * 0.6;
      let n = 0;
      for (const f of [0.33, 0.66, 0.9]) {
        let ok = true;
        for (let t = 2; t < stop && ok; t += 2.5) {
          const px = x + (l.x - x) * t / d, pz = z + (l.z - z) * t / d;
          if (hit(px, pz, 1.6 + (H * f - 1.6) * t / d)) ok = false;
        }
        if (ok) n++;
      }
      return n;
    };
    let best: [number, number, number] | undefined, bestScore = -Infinity;
    for (const c of cands.slice(0, 400)) {
      const v = sees(c[0], c[1]);
      if (v < 0) continue;
      const score = v * 1000 - c[2];
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) return null;
    return { text: l.text, x: best[0], z: best[1], yaw: Math.atan2(-(l.x - best[0]), -(l.z - best[1])) };
  }
