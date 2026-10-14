import * as THREE from 'three';
import { heightAt } from './terrain';
import { joinByName } from './people';
import type { City } from './types';

/* ── The horse tram ─────────────────────────────────────────────
   The Potsdamer Pferdebahn ran from 1880 until electrification in
   1907. Each joined route (tools/build-city.ts) gets one car per
   1.4 km, pulled by a horse at a slow trot (2.6 m/s), stopping for a
   while at each end before it turns back. A car is a single-deck box
   with open platforms, cream above the waist and dark green below,
   on four small wheels; the horse walks with its legs swinging.

   Cars are not solid: you can stand in their way, and they are slow
   enough to step aside for (stepTraffic returns where they are, so the
   walker can be nudged out of the way). */

const SPEED = 2.6, DWELL = 25;

interface Route { pts: number[]; cum: number[]; L: number }
interface Car { route: Route; s: number; dir: 1 | -1; wait: number; obj: THREE.Group; legs: THREE.Object3D[]; phase: number }

function route(pts: number[]): Route {
  const cum = [0];
  for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1]! + Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!));
  return { pts, cum, L: cum[cum.length - 1]! };
}
function at(r: Route, s: number): [number, number, number] {
  s = Math.max(0, Math.min(r.L, s));
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i]! < s) i++;
  const t = (s - r.cum[i - 1]!) / Math.max(1e-6, r.cum[i]! - r.cum[i - 1]!);
  const ax = r.pts[2 * i - 2]!, az = r.pts[2 * i - 1]!, bx = r.pts[2 * i]!, bz = r.pts[2 * i + 1]!;
  return [ax + (bx - ax) * t, az + (bz - az) * t, Math.atan2(bx - ax, bz - az)];
}

function carMesh() {
  const g = new THREE.Group();
  const cream = new THREE.MeshStandardMaterial({ color: 0xe6dcc0, roughness: 0.6 });
  const green = new THREE.MeshStandardMaterial({ color: 0x2c4a33, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e1c1a, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.1, metalness: 0.2 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z); b.castShadow = true; g.add(b); return b;
  };
  // the saloon: 4.2 m long, platforms 0.9 m at each end (car runs along +z)
  box(1.95, 0.95, 4.2, 0, 1.05, 0, green);
  box(1.95, 0.95, 4.2, 0, 2.0, 0, cream);
  for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) box(0.04, 0.65, 0.62, sx * 0.99, 2.05, -1.6 + k * 0.8, glass);
  box(2.1, 0.12, 6.2, 0, 2.55, 0, cream);                          // roof
  box(1.8, 0.18, 6.0, 0, 2.68, 0, cream);                          // clerestory
  for (const sz of [-1, 1]) {
    box(1.9, 0.1, 0.9, 0, 0.6, sz * 2.55, dark);                    // platform floor
    box(0.06, 1.9, 0.06, 0.9, 1.6, sz * 3.0, dark);                 // platform posts
    box(0.06, 1.9, 0.06, -0.9, 1.6, sz * 3.0, dark);
    box(1.8, 0.5, 0.05, 0, 0.95, sz * 3.0, green);                  // dash
  }
  for (const sx of [-0.72, 0.72]) for (const sz of [-1.2, 1.2]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 14), dark);
    w.rotation.z = Math.PI / 2; w.position.set(sx, 0.38, sz); g.add(w);
  }
  return g;
}

function horseMesh() {
  const g = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 1.7), coat);
  body.position.set(0, 1.35, 0); body.castShadow = true; g.add(body);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.85, 0.42), coat);
  neck.position.set(0, 1.85, 0.85); neck.rotation.x = 0.55; neck.castShadow = true; g.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.65), coat);
  head.position.set(0, 2.15, 1.25); head.rotation.x = 0.35; head.castShadow = true; g.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.65, 0.12), dark);
  tail.position.set(0, 1.25, -0.9); tail.rotation.x = -0.35; g.add(tail);
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.2, 0.62], [0.2, 0.62], [-0.2, -0.62], [0.2, -0.62]] as const) {
    const pivot = new THREE.Object3D();
    pivot.position.set(x, 1.1, z);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 1.1, 0.15), coat);
    leg.position.y = -0.55; leg.castShadow = true;
    const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.17), dark);
    hoof.position.y = -1.08;
    pivot.add(leg, hoof); g.add(pivot); legs.push(pivot);
  }
  return { g, legs };
}

/* A Droschke: a closed black cab on four wheels, the rear pair large,
   the coachman up front on his box. */
function cabMesh(seed: number) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: [0x15161a, 0x1e2a22, 0x2a1a16][seed % 3]!, roughness: 0.35, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.7 });
  const coat = new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.1 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; g.add(b); return b;
  };
  box(1.3, 1.15, 1.7, 0, 1.35, -0.3, body);                    // the cab
  box(1.32, 0.45, 0.8, 0, 1.55, -0.3, glass).scale.set(1, 1, 0.9);
  box(1.4, 0.06, 1.85, 0, 1.96, -0.3, dark);                    // roof
  box(1.1, 0.12, 1.2, 0, 1.0, 0.95, body);                      // footboard
  box(0.8, 0.35, 0.5, 0, 1.55, 0.75, body);                     // the coachman's box
  const man = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.75, 8), coat); man.position.set(0, 2.05, 0.75); man.castShadow = true; g.add(man);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd9a98a })); hd.position.set(0, 2.55, 0.75); g.add(hd);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 8), dark); hat.position.set(0, 2.72, 0.75); g.add(hat);
  for (const [z, r] of [[-0.8, 0.62], [0.75, 0.42]] as const) for (const x of [-0.72, 0.72]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 18), dark);
    w.rotation.y = Math.PI / 2; w.position.set(x, r, z); g.add(w);
  }
  return g;
}

export function buildTraffic(city: City) {
  const group = new THREE.Group();
  group.name = 'traffic';
  const cars: Car[] = [];
  for (const r of city.rails) {
    if (r.kind !== 'tram') continue;
    const rt = route(r.pts);
    if (rt.L < 200) continue;
    const n = Math.max(1, Math.round(rt.L / 1400));
    for (let k = 0; k < n; k++) {
      const obj = new THREE.Group();
      const car = carMesh();
      car.position.z = -3.6;   // the car trails the horse
      const horse = horseMesh();
      horse.g.position.z = 1.1;
      obj.add(car, horse.g);
      group.add(obj);
      cars.push({ route: rt, s: rt.L * (k + 0.5) / n, dir: k % 2 ? -1 : 1, wait: 0, obj, legs: horse.legs, phase: k });
    }
  }
  // Droschken on the main streets, keeping to the right
  const cabs: { r: Route; s: number; dir: 1 | -1; v: number; obj: THREE.Group; legs: THREE.Object3D[]; phase: number; side: number }[] = [];
  const mains = joinByName(city.streets.filter((s) => s.kind === 'main'));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const st of mains) {
    const rt = route(st.pts);
    const n = Math.floor(rt.L / 350);
    for (let k = 0; k < n; k++) {
      const obj = new THREE.Group();
      const cab = cabMesh(cabs.length);
      cab.position.z = -1.6;
      const horse = horseMesh();
      horse.g.position.z = 1.6;
      obj.add(cab, horse.g);
      group.add(obj);
      cabs.push({ r: rt, s: rnd() * rt.L, dir: rnd() < 0.5 ? 1 : -1, v: 2.2 + rnd() * 1.6, obj, legs: horse.legs, phase: rnd() * 6, side: Math.min(3.2, st.w / 4) });
    }
  }
  const step = (dt: number) => {
    for (const c of cabs) {
      c.s += c.dir * c.v * dt;
      if (c.s >= c.r.L || c.s <= 0) { c.s = Math.max(0, Math.min(c.r.L, c.s)); c.dir = c.dir === 1 ? -1 : 1; }
      c.phase += dt * 2 * Math.PI * (0.9 + c.v * 0.25);
      const [x, z] = at(c.r, c.s), [ax, az] = at(c.r, c.s + c.dir * 2.5);
      const yaw = Math.atan2(ax - x, az - z);
      // right-hand traffic: the right of the direction of travel
      const ox = -Math.cos(yaw) * c.side, oz = Math.sin(yaw) * c.side;
      c.obj.position.set(x + ox, heightAt(x + ox, z + oz), z + oz);
      c.obj.rotation.y = yaw;
      c.legs.forEach((l, i) => { l.rotation.x = 0.5 * Math.sin(c.phase + (i === 0 || i === 3 ? 0 : Math.PI)); });
    }
    for (const c of cars) {
      if (c.wait > 0) c.wait -= dt;
      else {
        c.s += c.dir * SPEED * dt;
        if (c.s >= c.route.L || c.s <= 0) {
          c.s = Math.max(0, Math.min(c.route.L, c.s));
          c.dir = c.dir === 1 ? -1 : 1;   // the horse is put to the other end
          c.wait = DWELL;
        }
        c.phase += dt * 2 * Math.PI * 1.4;
      }
      const [x, z, h] = at(c.route, c.s);
      // look a little ahead for the heading, so turns are smooth
      const [ax, az] = at(c.route, c.s + c.dir * 3);
      c.obj.position.set(x, heightAt(x, z), z);
      c.obj.rotation.y = Math.atan2(ax - x, az - z) || (c.dir === 1 ? h : h + Math.PI);
      const moving = c.wait <= 0 ? 1 : 0;
      c.legs.forEach((l, i) => { l.rotation.x = moving * 0.45 * Math.sin(c.phase + (i === 0 || i === 3 ? 0 : Math.PI)); });
    }
  };
  return { group, step, cars, cabs };
}
