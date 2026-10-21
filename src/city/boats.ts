import * as THREE from 'three';
import type { Ground } from './ground';
import type { City } from './types';

/* ── Boats ──────────────────────────────────────────────────────
   Barges (Kähne) and a small steamer on the river within the town's
   bounds. Each keeps to open water by feeling ahead: when the water
   ends 25 m before its bow it turns toward whichever side stays wet
   longer, so they wander up and down the Havel and the Alte Fahrt. */

interface Boat { x: number; z: number; yaw: number; v: number; obj: THREE.Group }

/* A hull lofted from cross-sections along its length (bow toward +z):
   full amidships, drawn to a stem at the bow and rounded in at the
   stern, its sheer rising a little toward both ends; the sides tumble
   in below to a flat bottom. Open at the top: the deck closes it. */
function hullGeometry(L: number, W: number, D: number, bowSharp = 1) {
  const NS = 18, NP = 5;
  const pos: number[] = [];
  const sec = (t: number) => {
    // t from −1 (stern) to 1 (bow): half-beam and sheer
    const a = Math.abs(t);
    const half = t > 0 ? W / 2 * Math.pow(1 - Math.pow(a, 2.2), 0.55 * bowSharp) : W / 2 * Math.pow(1 - Math.pow(a, 3), 0.4);
    const sheer = D + 0.25 * a * a;
    // the section from the gunwale down to the keel: (x, y) pairs
    const pts: [number, number][] = [];
    for (let k = 0; k <= NP; k++) {
      const f = k / NP;
      pts.push([Math.max(0.02, half) * (1 - 0.25 * f * f), sheer - (sheer) * f]);
    }
    return { z: t * L / 2, pts };
  };
  const secs = Array.from({ length: NS + 1 }, (_, i) => sec(-1 + 2 * i / NS));
  for (let i = 0; i < NS; i++) {
    const a = secs[i]!, b = secs[i + 1]!;
    for (let k = 0; k < NP; k++) for (const sx of [-1, 1]) {
      const p = (s: typeof a, kk: number) => [sx * s.pts[kk]![0], s.pts[kk]![1], s.z];
      const q = [p(a, k), p(b, k), p(b, k + 1), p(a, k), p(b, k + 1), p(a, k + 1)];
      if (sx < 0) { [q[1], q[2]] = [q[2]!, q[1]!]; [q[4], q[5]] = [q[5]!, q[4]!]; }
      for (const v of q) pos.push(...v as number[]);
    }
    // the flat bottom
    const ka = a.pts[NP]!, kb = b.pts[NP]!;
    for (const v of [[-ka[0], 0, a.z], [kb[0], 0, b.z], [-kb[0], 0, b.z], [-ka[0], 0, a.z], [ka[0], 0, a.z], [kb[0], 0, b.z]]) pos.push(...v);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return { geo: g, half: (t: number) => sec(t).pts[0]![0], sheer: (t: number) => sec(t).pts[0]![1] };
}

function barge(seed: number) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: [0x4a3626, 0x3a2c22, 0x5a4230][seed % 3]!, roughness: 0.85 });
  const tar = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.8 });
  const cargo = new THREE.MeshStandardMaterial({ color: [0x8a5a3a, 0x9a8a6a, 0x5a5048][seed % 3]!, roughness: 0.95 });
  // a Kahn: long, flat, low in the water, tarred black; planked deck
  const h = hullGeometry(24, 4.4, 1.25, 0.7);
  const hull = new THREE.Mesh(h.geo, tar);
  hull.position.y = -0.45; g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.08, 21), wood);
  deck.position.y = 0.72; g.add(deck);
  const load = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.0, 14), cargo);   // bricks, timber or hay
  load.position.set(0, 1.35, 0); g.add(load);
  const hut = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 2.6), wood);
  hut.position.set(0, 1.6, -9.5); g.add(hut);
  for (const m of g.children) (m as THREE.Mesh).castShadow = true;
  return g;
}
function steamer() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0x8a2a20, roughness: 0.6 });
  const h = hullGeometry(26, 5, 1.6, 1.3);
  const hull = new THREE.Mesh(h.geo, dark); hull.position.y = -0.5; g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2, 15), white); deck.position.y = 2; g.add(deck);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.15, 18), white); roof.position.y = 3.1; g.add(roof);
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 3.2, 12), red); funnel.position.set(0, 4.6, 1.5); g.add(funnel);
  for (const sx of [-1, 1]) {
    const box = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.8, 16, 1, false, 0, Math.PI), white);
    box.rotation.z = Math.PI / 2; box.rotation.y = sx > 0 ? 0 : Math.PI; box.position.set(sx * 2.8, 1.2, 1.5); g.add(box);   // paddle boxes
  }
  for (const m of g.children) (m as THREE.Mesh).castShadow = true;
  return g;
}

export function buildBoats(city: City, ground: Ground) {
  const group = new THREE.Group();
  group.name = 'boats';
  const [x0, z0, x1, z1] = city.bounds;
  const wet = (x: number, z: number) => x > x0 + 30 && x < x1 - 30 && z > z0 + 30 && z < z1 - 30 && ground.isWater(x, z)
    && ground.isWater(x + 4, z) && ground.isWater(x - 4, z) && ground.isWater(x, z + 4) && ground.isWater(x, z - 4);
  // places to start: open water on a grid, kept apart
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const boats: Boat[] = [];
  for (let tries = 0; tries < 4000 && boats.length < 7; tries++) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    if (!wet(x, z) || boats.some((b) => Math.hypot(b.x - x, b.z - z) < 120)) continue;
    const obj = boats.length === 0 ? steamer() : barge(boats.length);
    group.add(obj);
    boats.push({ x, z, yaw: rnd() * Math.PI * 2, v: boats.length === 0 ? 3.2 : 1 + rnd() * 0.8, obj });
  }
  const ahead = (b: Boat, yaw: number, d: number) => { let n = 0; for (let s = 6; s <= d; s += 6) { if (!wet(b.x + Math.sin(yaw) * s, b.z + Math.cos(yaw) * s)) break; n++; } return n; };
  const step = (dt: number, level: number) => {
    for (const b of boats) {
      if (ahead(b, b.yaw, 30) < 5) {
        // turn toward the side with more open water
        const l = ahead(b, b.yaw + 0.6, 60), r = ahead(b, b.yaw - 0.6, 60);
        b.yaw += (l >= r ? 1 : -1) * 0.35 * dt * (1 + b.v * 0.2);
      }
      const nx = b.x + Math.sin(b.yaw) * b.v * dt, nz = b.z + Math.cos(b.yaw) * b.v * dt;
      if (wet(nx, nz)) { b.x = nx; b.z = nz; } else b.yaw += Math.PI * dt * 0.3;
      b.obj.position.set(b.x, level + Math.sin(b.x * 0.1 + b.z * 0.07) * 0.03, b.z);
      b.obj.rotation.y = b.yaw;
    }
  };
  return { group, step, boats };
}
