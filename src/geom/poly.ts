/* Plane polygon helpers on flat [x0, z0, x1, z1, …] rings. Imports
   nothing, so the build tools (Node) and the app share it. */
export type Ring = number[];

// Signed area, positive when the ring runs x→z (clockwise on a map
// with z pointing down the page, counter-clockwise seen from above
// with y up — the winding three's front faces want for a floor).
export function area(r: Ring): number {
  let a = 0;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) a += r[j]! * r[i + 1]! - r[i]! * r[j + 1]!;
  return a / 2;
}

export function reverse(r: Ring): Ring {
  const o: Ring = [];
  for (let i = r.length - 2; i >= 0; i -= 2) o.push(r[i]!, r[i + 1]!);
  return o;
}

export function orient(r: Ring, positive: boolean): Ring {
  return (area(r) > 0) === positive ? r : reverse(r);
}

export function inside(r: Ring, x: number, z: number): boolean {
  let c = false;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = r[i]!, zi = r[i + 1]!, xj = r[j]!, zj = r[j + 1]!;
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export function centroid(r: Ring): [number, number] {
  let a = 0, cx = 0, cz = 0;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const f = r[j]! * r[i + 1]! - r[i]! * r[j + 1]!;
    a += f; cx += (r[j]! + r[i]!) * f; cz += (r[j + 1]! + r[i + 1]!) * f;
  }
  if (Math.abs(a) < 1e-9) return [r[0]!, r[1]!];
  return [cx / (3 * a), cz / (3 * a)];
}

export function bbox(r: Ring): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const x = r[i]!, z = r[i + 1]!;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return [x0, z0, x1, z1];
}

/* The minimum-area enclosing rectangle, by rotating calipers over the
   ring's own edges (the optimum always has a side along a hull edge;
   trying every edge of the ring is a superset of the hull's). Returns
   the angle of its first axis from +x and the half-extents along it
   (a) and across it (b), and its centre. */
export interface OBB { ang: number; cx: number; cz: number; a: number; b: number }
export function obb(r: Ring): OBB {
  let best: OBB = { ang: 0, cx: 0, cz: 0, a: 0, b: 0 }, bestA = Infinity;
  const n = r.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const dx = r[i]! - r[j]!, dz = r[i + 1]! - r[j + 1]!;
    if (dx * dx + dz * dz < 1e-6) continue;
    const ang = Math.atan2(dz, dx);
    const f = fit(r, ang);
    const A = f.a * f.b;
    if (A < bestA - 1e-6) { bestA = A; best = f; }
  }
  return best;
}

/* The enclosing rectangle with its first axis at a given angle. */
export function fit(r: Ring, ang: number): OBB {
  const c = Math.cos(ang), s = Math.sin(ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let k = 0; k < r.length; k += 2) {
    const u = r[k]! * c + r[k + 1]! * s, v = -r[k]! * s + r[k + 1]! * c;
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  return { ang, cx: um * c - vm * s, cz: um * s + vm * c, a: (u1 - u0) / 2, b: (v1 - v0) / 2 };
}

// Squared distance from a point to a segment.
export function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  let t = L > 0 ? ((px - ax) * dx + (pz - az) * dz) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px, ez = az + t * dz - pz;
  return ex * ex + ez * ez;
}

/* Douglas–Peucker on a ring, keeping points that move the outline by
   more than eps metres. Mapped footprints carry many nodes on straight
   walls (shared with neighbours); each one is a wall segment and two
   window bays drawn for nothing. */
export function simplify(r: Ring, eps: number): Ring {
  const n = r.length / 2;
  if (n <= 4) return r;
  const keep = new Uint8Array(n);
  // Anchor on the two points farthest apart, then split each half.
  let far = 0, d0 = -1;
  for (let i = 1; i < n; i++) {
    const d = (r[2 * i]! - r[0]!) ** 2 + (r[2 * i + 1]! - r[1]!) ** 2;
    if (d > d0) { d0 = d; far = i; }
  }
  keep[0] = 1; keep[far] = 1;
  const rec = (i: number, j: number) => {   // j may exceed n: wrap
    let md = -1, mi = -1;
    const ax = r[2 * (i % n)]!, az = r[2 * (i % n) + 1]!, bx = r[2 * (j % n)]!, bz = r[2 * (j % n) + 1]!;
    for (let k = i + 1; k < j; k++) {
      const d = segDist2(r[2 * (k % n)]!, r[2 * (k % n) + 1]!, ax, az, bx, bz);
      if (d > md) { md = d; mi = k; }
    }
    if (mi >= 0 && md > eps * eps) { keep[mi % n] = 1; rec(i, mi); rec(mi, j); }
  };
  rec(0, far); rec(far, n);
  const o: Ring = [];
  for (let i = 0; i < n; i++) if (keep[i]) o.push(r[2 * i]!, r[2 * i + 1]!);
  return o.length >= 6 ? o : r;
}

/* Move every edge of a ring d metres inward (d < 0: outward), with
   mitred corners whose reach is capped at 3d, so a sharp corner
   cannot shoot across the polygon. Assumes positive orientation. */
export function inset(r: Ring, d: number): Ring {
  const n = r.length / 2, o: Ring = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n, q = (i + 1) % n;
    const x = r[2 * i]!, z = r[2 * i + 1]!;
    let ax = x - r[2 * p]!, az = z - r[2 * p + 1]!, bx = r[2 * q]! - x, bz = r[2 * q + 1]! - z;
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    // inward normals of a positive ring: (−dz, dx)
    let nx = -az - bz, nz = ax + bx;
    const nl = Math.hypot(nx, nz);
    if (nl < 1e-9) { nx = -az; nz = ax; } else { nx /= nl; nz /= nl; }
    const cosHalf = Math.max(1 / 3, nx * -az + nz * ax);
    o.push(x + nx * d / cosHalf, z + nz * d / cosHalf);
  }
  return o;
}

/* Drop vertices where the outline turns by less than minTurn
   radians, as long as that moves it by no more than maxShift metres:
   a traced pixel outline's wobble, merged into straight frontages. */
export function straighten(r: Ring, minTurn: number, maxShift: number): Ring {
  let o = r.slice();
  for (let changed = true; changed && o.length > 6;) {
    changed = false;
    const n = o.length / 2;
    let best = -1, bestTurn = minTurn;
    for (let i = 0; i < n; i++) {
      const p = (i + n - 1) % n, q = (i + 1) % n;
      const ax = o[2 * i]! - o[2 * p]!, az = o[2 * i + 1]! - o[2 * p + 1]!;
      const bx = o[2 * q]! - o[2 * i]!, bz = o[2 * q + 1]! - o[2 * i + 1]!;
      const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
      if (turn >= bestTurn) continue;
      const d = Math.sqrt(segDist2(o[2 * i]!, o[2 * i + 1]!, o[2 * p]!, o[2 * p + 1]!, o[2 * q]!, o[2 * q + 1]!));
      if (d > maxShift) continue;
      best = i; bestTurn = turn;
    }
    if (best >= 0) { o.splice(2 * best, 2); changed = true; }
  }
  return o;
}
