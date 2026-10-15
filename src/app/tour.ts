/* ── The tour ───────────────────────────────────────────────────
   T walks you round the town by itself: from where you are to the
   nearest described landmark not yet seen, then the next, along the
   streets of the year — a shortest path on the street graph, whose
   vertices are the streets' own points (OSM ways share their nodes at
   crossings, so crossings are where the graph branches). At each stop
   it turns to the landmark and waits while the HUD tells its story.
   Any key or click hands the walk back. Pure apart from the walker
   object it steers. */
import type { City, Label } from '../city/types';
import { viewpoint } from './viewpoint';

interface Graph { x: Float64Array; z: Float64Array; adj: number[][]; main: Uint8Array }

export function streetGraph(city: City): Graph {
  const ids = new Map<string, number>();
  const xs: number[] = [], zs: number[] = [], adj: number[][] = [];
  const node = (x: number, z: number) => {
    const k = Math.round(x * 2) + ',' + Math.round(z * 2);   // half a metre
    let i = ids.get(k);
    if (i === undefined) { i = xs.length; ids.set(k, i); xs.push(x); zs.push(z); adj.push([]); }
    return i;
  };
  for (const s of city.streets) {
    if (s.kind === 'lane') continue;
    let prev = -1;
    for (let k = 0; k < s.pts.length; k += 2) {
      const i = node(s.pts[k]!, s.pts[k + 1]!);
      if (prev >= 0 && prev !== i) { adj[prev]!.push(i); adj[i]!.push(prev); }
      prev = i;
    }
  }
  // OHM's streets and OSM's share no nodes: link points within 2.5 m
  const G = 2.5, cells = new Map<string, number[]>();
  for (let i = 0; i < xs.length; i++) {
    const k = Math.floor(xs[i]! / G) + ',' + Math.floor(zs[i]! / G);
    let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(i);
  }
  for (let i = 0; i < xs.length; i++) {
    const cx = Math.floor(xs[i]! / G), cz = Math.floor(zs[i]! / G);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of cells.get((cx + a) + ',' + (cz + b)) ?? []) {
      if (j <= i || Math.hypot(xs[j]! - xs[i]!, zs[j]! - zs[i]!) > G || adj[i]!.includes(j)) continue;
      adj[i]!.push(j); adj[j]!.push(i);
    }
  }
  // the largest connected piece; walks start and end only there
  const comp = new Int32Array(xs.length).fill(-1);
  let best = -1, bestN = 0;
  for (let s0 = 0, c = 0; s0 < xs.length; s0++) {
    if (comp[s0] !== -1) continue;
    const st = [s0]; comp[s0] = c; let n = 0;
    while (st.length) { const i = st.pop()!; n++; for (const j of adj[i]!) if (comp[j] === -1) { comp[j] = c; st.push(j); } }
    if (n > bestN) { bestN = n; best = c; }
    c++;
  }
  const main = new Uint8Array(xs.length);
  for (let i = 0; i < xs.length; i++) main[i] = comp[i] === best ? 1 : 0;
  return { x: Float64Array.from(xs), z: Float64Array.from(zs), adj, main };
}

export function nearestNode(g: Graph, x: number, z: number) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < g.x.length; i++) {
    const d = (g.x[i]! - x) ** 2 + (g.z[i]! - z) ** 2;
    if (d < bd && g.main[i]) { bd = d; best = i; }
  }
  return best;
}

/* Dijkstra with a binary heap; returns the path as [x, z, …]. */
export function shortestPath(g: Graph, from: number, to: number): number[] | null {
  const n = g.x.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const heap: [number, number][] = [];
  const push = (d: number, i: number) => {
    heap.push([d, i]);
    for (let c = heap.length - 1; c > 0;) { const p = (c - 1) >> 1; if (heap[p]![0] <= heap[c]![0]) break; [heap[p], heap[c]] = [heap[c]!, heap[p]!]; c = p; }
  };
  const pop = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let c = 0; ;) {
        const l = 2 * c + 1, r = l + 1;
        let m = c;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c]!, heap[m]!]; c = m;
      }
    }
    return top;
  };
  dist[from] = 0; push(0, from);
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]!) continue;
    if (i === to) break;
    for (const j of g.adj[i]!) {
      const nd = d + Math.hypot(g.x[j]! - g.x[i]!, g.z[j]! - g.z[i]!);
      if (nd < dist[j]!) { dist[j] = nd; prev[j] = i; push(nd, j); }
    }
  }
  if (!Number.isFinite(dist[to]!)) return null;
  const out: number[] = [];
  for (let i = to; i >= 0; i = prev[i]!) out.unshift(g.x[i]!, g.z[i]!);
  return out;
}

interface Walker { x: number; z: number; yaw: number; pitch: number; fly: boolean; auto: { vx: number; vz: number } | null }

export function makeTour(city: City) {
  let g: Graph | null = null;
  const stops = city.labels.filter((l) => l.kind === 'landmark' && l.about);
  let on = false, path: number[] = [], k = 0, wait = 0, target: Label | null = null;
  const seen = new Set<string>();

  // the next stop: the nearest unseen landmark, reached at the street
  // point nearest to it that is clear of its own bulk
  const plan = (w: Walker) => {
    g ??= streetGraph(city);
    const left = stops.filter((l) => !seen.has(l.text));
    if (!left.length) seen.clear();
    const pool = left.length ? left : stops;
    pool.sort((a, b) => Math.hypot(a.x - w.x, a.z - w.z) - Math.hypot(b.x - w.x, b.z - w.z));
    for (const l of pool) {
      // walk to where it is best seen from (app/viewpoint.ts)
      const v = viewpoint(city, l);
      if (!v) continue;
      const best = nearestNode(g, v.x, v.z);
      const p = shortestPath(g, nearestNode(g, w.x, w.z), best);
      seen.add(l.text);
      if (!p) continue;
      path = [w.x, w.z, ...p]; k = 2; target = l;
      return true;
    }
    return false;
  };

  return {
    get on() { return on; },
    get target() { return target; },
    start(w: Walker) { on = plan(w); wait = 0; return on; },
    stop(w: Walker) { on = false; w.auto = null; },
    /* Steer the walker for one frame; returns false when it gives up. */
    step(dt: number, w: Walker) {
      if (!on) return;
      w.fly = false;
      if (wait > 0) {
        wait -= dt;
        if (target) turnTo(w, Math.atan2(-(target.x - w.x), -(target.z - w.z)), dt, 1.5, 0.18);
        w.auto = { vx: 0, vz: 0 };
        if (wait <= 0 && !plan(w)) { on = false; w.auto = null; }
        return;
      }
      // walk toward the path's next point at a stroll
      let tx = path[k]!, tz = path[k + 1]!;
      while (Math.hypot(tx - w.x, tz - w.z) < 1.2 && k + 2 < path.length) { k += 2; tx = path[k]!; tz = path[k + 1]!; }
      const d = Math.hypot(tx - w.x, tz - w.z);
      if (k + 2 >= path.length && d < 1.2) { wait = 14; return; }
      const v = 1.4, ux = (tx - w.x) / d, uz = (tz - w.z) / d;
      w.auto = { vx: ux * v, vz: uz * v };
      // look where we go, and toward the landmark once it is near
      const near = target && Math.hypot(target.x - w.x, target.z - w.z) < 90;
      const yaw = near ? Math.atan2(-(target!.x - w.x), -(target!.z - w.z)) : Math.atan2(-ux, -uz);
      turnTo(w, yaw, dt, near ? 1.2 : 2.5, near ? 0.12 : 0);
    },
  };
}

function turnTo(w: Walker, yaw: number, dt: number, rate: number, pitch: number) {
  let d = yaw - w.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  w.yaw += d * Math.min(1, dt * rate);
  w.pitch += (pitch - w.pitch) * Math.min(1, dt * 1.5);
}
