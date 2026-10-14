import * as THREE from 'three';
import type { Ground } from './ground';
import type { City } from './types';

/* ── Boats ──────────────────────────────────────────────────────
   Barges (Kähne) and a small steamer on the river within the town's
   bounds. Each keeps to open water by feeling ahead: when the water
   ends 25 m before its bow it turns toward whichever side stays wet
   longer, so they wander up and down the Havel and the Alte Fahrt.
   The steamer trails a little smoke. */

interface Boat { x: number; z: number; yaw: number; v: number; obj: THREE.Group }

function barge(seed: number) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: [0x4a3626, 0x3a2c22, 0x5a4230][seed % 3]!, roughness: 0.85 });
  const tar = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.8 });
  const cargo = new THREE.MeshStandardMaterial({ color: [0x8a5a3a, 0x9a8a6a, 0x5a5048][seed % 3]!, roughness: 0.95 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 24), tar);
  hull.position.y = 0.2; g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.12, 23), wood);
  deck.position.y = 0.8; g.add(deck);
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
  const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 1.5, 26), dark); hull.position.y = 0.3; g.add(hull);
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
