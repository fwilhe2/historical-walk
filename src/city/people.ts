import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from './terrain';
import type { City } from './types';

/* ── People ─────────────────────────────────────────────────────
   Townspeople of 1900 on the pavements: men in dark frock coats under
   top hats or bowlers, women in long skirts and jackets with hats, and
   — Potsdam was a garrison town — soldiers in Prussian blue with the
   spiked helmet. Each walks one street of the year at 1.1–1.5 m/s on
   one side, turning back at its ends; some stand a while.

   Figures are a few instanced parts each, turned on a lathe from the
   profiles of the clothes: a frock coat with its tails (or a tunic), or
   a fitted bodice over a bell skirt gathered in folds; tapered legs in
   dark shoes, gloved arms, a head on a high white collar, the hat.
   Posed per frame: a walk swings the legs and, against them, the arms,
   and bobs the body. Only the figures within 300 m are drawn; the rest still
   walk, unseen. Seeded, so the same people walk the same
   streets every time. */

type Kind = 'man' | 'woman' | 'soldier';
interface Person { kind: Kind; pts: number[]; cum: number[]; L: number; s: number; dir: 1 | -1; off: number; v: number; pause: number; phase: number; h: number }

const N = 1200;

export function joinByName(list: City['streets']): City['streets'] {
  const out: City['streets'] = [];
  const pool = list.map((s) => ({ ...s, pts: s.pts.slice() }));
  const near = (a: number[], i: number, b: number[], j: number) => Math.abs(a[i]! - b[j]!) < 0.5 && Math.abs(a[i + 1]! - b[j + 1]!) < 0.5;
  const rev = (r: number[]) => { const o: number[] = []; for (let k = r.length - 2; k >= 0; k -= 2) o.push(r[k]!, r[k + 1]!); return o; };
  while (pool.length) {
    const cur = pool.pop()!;
    if (cur.name) for (let grown = true; grown;) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const o = pool[i]!;
        if (o.name !== cur.name) continue;
        const n = cur.pts.length, m = o.pts.length;
        if (near(cur.pts, n - 2, o.pts, 0)) cur.pts = cur.pts.concat(o.pts.slice(2));
        else if (near(cur.pts, n - 2, o.pts, m - 2)) cur.pts = cur.pts.concat(rev(o.pts).slice(2));
        else if (near(cur.pts, 0, o.pts, m - 2)) cur.pts = o.pts.slice(0, -2).concat(cur.pts);
        else if (near(cur.pts, 0, o.pts, 0)) cur.pts = rev(o.pts).slice(0, -2).concat(cur.pts);
        else continue;
        if (o.busy) cur.busy = true;
        pool.splice(i, 1); grown = true; break;
      }
    }
    out.push(cur);
  }
  return out.filter((s) => { let L = 0; for (let i = 2; i < s.pts.length; i += 2) L += Math.hypot(s.pts[i]! - s.pts[i - 2]!, s.pts[i + 1]! - s.pts[i - 1]!); return L > 25; });
}

function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

export function buildPeople(city: City) {
  const group = new THREE.Group();
  group.name = 'people';
  const r = rng(1900);
  // OSM cuts a street at every crossing; walkers want whole streets,
  // so segments of the same name meeting end to end are joined
  const streets = joinByName(city.streets.filter((s) => (s.kind === 'main' || s.kind === 'street') && s.pts.length >= 4));
  // longer streets get more people
  // and the busy ones more still: main streets, and the town's middle
  // (the old town and the baroque extension) far more than its edges
  const lens = streets.map((s) => {
    let L = 0;
    for (let i = 2; i < s.pts.length; i += 2) L += Math.hypot(s.pts[i]! - s.pts[i - 2]!, s.pts[i + 1]! - s.pts[i - 1]!);
    const mx = s.pts[0]!, mz = s.pts[1]!;
    const [ccx, ccz, ccr] = city.centre;
    const central = Math.hypot(mx - ccx, mz - ccz) < ccr ? 3 : 0.4;
    return L * central * (s.busy ? 4 : s.kind === 'main' ? 1.8 : 1);
  });
  const total = lens.reduce((a, b) => a + b, 0);
  const people: Person[] = [];
  for (let k = 0; k < N && streets.length; k++) {
    let t = r() * total, i = 0;
    while (i < lens.length - 1 && t > lens[i]!) { t -= lens[i]!; i++; }
    const st = streets[i]!;
    // (lens are weights now; the position along the street is by its length)
    const cum = [0];
    for (let j = 2; j < st.pts.length; j += 2) cum.push(cum[cum.length - 1]! + Math.hypot(st.pts[j]! - st.pts[j - 2]!, st.pts[j + 1]! - st.pts[j - 1]!));
    const u = r();
    const kind: Kind = u < 0.22 ? 'soldier' : u < 0.62 ? 'man' : 'woman';
    people.push({
      kind, pts: st.pts, cum, L: cum[cum.length - 1]!, s: r() * cum[cum.length - 1]!, dir: r() < 0.5 ? 1 : -1,
      off: (r() < 0.5 ? -1 : 1) * Math.max(1.5, st.w / 2 - 1.3), v: 1.1 + r() * 0.4, pause: r() < 0.15 ? r() * 20 : 0,
      phase: r() * 10, h: 0.94 + r() * 0.12,
    });
  }

  // Parts. Vertex colours shade within a part (shoes, gloves, collar);
  // the instance colour (coat, skin) multiplies them.
  const tint = (g: THREE.BufferGeometry, c: number) => {
    const n = g.attributes.position!.count, a = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) a.set([c, c, c], k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  // a body of revolution from [y, r] pairs, flattened front to back,
  // with folds if asked
  const lathe = (prof: [number, number][], depth: number, folds = 0) => {
    const g = new THREE.LatheGeometry(prof.map(([y, r]) => new THREE.Vector2(r, y)), 9);
    const p = g.attributes.position!;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const f = folds ? 1 + folds * Math.sin(Math.atan2(z, x) * 11) * Math.max(0, -y) : 1;
      p.setXYZ(k, x * f, y, z * depth * f);
    }
    g.computeVertexNormals();
    return g;
  };
  const merge = (...gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => { g.deleteAttribute('uv'); return g; }))!;
  const cloth = new THREE.MeshStandardMaterial({ roughness: 0.95, vertexColors: true, side: THREE.DoubleSide });
  const skin = new THREE.MeshStandardMaterial({ roughness: 0.65, vertexColors: true });
  const n = people.length;
  const mk = (g: THREE.BufferGeometry, m: THREE.Material) => { const im = new THREE.InstancedMesh(g, m, n); im.castShadow = true; im.frustumCulled = false; group.add(im); return im; };
  // a leg from the hip down: trouser, tapering, and a dark shoe
  const legGeo = () => merge(
    tint(new THREE.CylinderGeometry(0.075, 0.05, 0.8, 6, 1, true).translate(0, -0.4, 0), 1),
    tint(new THREE.BoxGeometry(0.09, 0.06, 0.24).translate(0, -0.83, 0.04), 0.12));
  const legL = mk(legGeo(), cloth);
  const legR = mk(legGeo(), cloth);
  // an arm from the shoulder: sleeve and gloved hand
  const armGeo = () => merge(
    tint(new THREE.CylinderGeometry(0.055, 0.042, 0.58, 6, 1, true).translate(0, -0.29, 0), 1),
    tint(new THREE.SphereGeometry(0.045, 5, 4).scale(0.8, 1.2, 0.6).translate(0, -0.63, 0.01), 0.25));
  const armL = mk(armGeo(), cloth);
  const armR = mk(armGeo(), cloth);
  // a frock coat from the knees (its tails) to the collar
  const coat = mk(tint(lathe([[-0.42, 0.0], [-0.42, 0.215], [-0.2, 0.2], [0, 0.18], [0.14, 0.17], [0.3, 0.18], [0.45, 0.2], [0.55, 0.205], [0.6, 0.16], [0.63, 0.08], [0.64, 0.0]], 0.72), 1), cloth);
  // a bodice from the waist up, and a skirt from the waist to the ground
  const bodice = mk(tint(lathe([[0, 0.0], [0, 0.13], [0.14, 0.15], [0.27, 0.172], [0.38, 0.17], [0.45, 0.14], [0.49, 0.08], [0.5, 0.0]], 0.75), 1), cloth);
  const skirt = mk(tint(lathe([[0.02, 0.0], [0.02, 0.135], [-0.15, 0.17], [-0.4, 0.24], [-0.7, 0.32], [-0.92, 0.38], [-0.95, 0.38], [-0.95, 0.0]], 0.85, 0.06), 1), cloth);
  // the head on its neck, in a white collar
  const head = mk(merge(
    tint(new THREE.SphereGeometry(0.1, 9, 6).scale(0.88, 1.12, 0.95).translate(0, 0.13, 0.005), 1),
    tint(new THREE.CylinderGeometry(0.048, 0.052, 0.09, 6, 1, true).translate(0, 0.02, 0), 1),
    tint(new THREE.CylinderGeometry(0.06, 0.062, 0.05, 8, 1, true).translate(0, 0.0, 0), 1.25)), skin);
  const hat = mk(tint(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 9).translate(0, 0.09, 0), 1), cloth);
  const brim = mk(tint(new THREE.CylinderGeometry(0.17, 0.17, 0.015, 10, 1, true), 1), cloth);
  const spike = mk(new THREE.ConeGeometry(0.025, 0.12, 6).translate(0, 0.06, 0), new THREE.MeshStandardMaterial({ color: 0xc9b26a, metalness: 0.8, roughness: 0.3 }));
  const PARTS = [legL, legR, armL, armR, coat, bodice, skirt, head, hat, brim, spike];
  for (const im of PARTS) { im.setColorAt(0, new THREE.Color(1, 1, 1)); im.count = 0; }

  const COAT: Record<Kind, number[]> = {
    man: [0x2a2a2e, 0x3a3128, 0x23262c, 0x46403a, 0x2d2a26],
    woman: [0x4a2e2e, 0x2e3a4a, 0x3a3a3a, 0x5a4a3a, 0x2e2a3a, 0x6a5a48],
    soldier: [0x1f2a4a],
  };
  // each person's colours, by part, written with the matrices of those
  // drawn this frame (only the people near enough are drawn, packed at
  // the front of each part's instances)
  const col = new THREE.Color();
  const cols = people.map((p) => {
    const pal = COAT[p.kind];
    const c = new THREE.Color(pal[Math.floor(r() * pal.length)]!);
    const legs = p.kind === 'man' && r() < 0.4 ? new THREE.Color(0x4a4844) : p.kind === 'soldier' ? new THREE.Color(0x1a1a1e) : c;
    const face = new THREE.Color().setRGB(0.62 + 0.12 * r(), 0.42 + 0.08 * r(), 0.32 + 0.06 * r());
    const hatC = new THREE.Color(p.kind === 'soldier' ? 0x15151a : p.kind === 'woman' ? [0x5a3a2a, 0x2a2a2a, 0x7a6a50][Math.floor(r() * 3)]! : 0x18181a);
    const brimC = new THREE.Color(p.kind === 'soldier' ? 0x15151a : 0x18181a);
    return new Map<THREE.InstancedMesh, THREE.Color>([[legL, legs], [legR, legs], [armL, c], [armR, c], [coat, c], [bodice, c], [skirt, c], [head, face], [hat, hatC], [brim, brimC], [spike, col.setHex(0xffffff).clone()]]);
  });

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), t = new THREE.Vector3();
  const at = (p: Person, s: number): [number, number, number] => {
    s = Math.max(0, Math.min(p.L, s));
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i]! < s) i++;
    const a = (s - p.cum[i - 1]!) / Math.max(1e-6, p.cum[i]! - p.cum[i - 1]!);
    const ax = p.pts[2 * i - 2]!, az = p.pts[2 * i - 1]!, bx = p.pts[2 * i]!, bz = p.pts[2 * i + 1]!;
    const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L;
    return [ax + (bx - ax) * a + nx * p.off, az + (bz - az) * a + nz * p.off, Math.atan2(bx - ax, bz - az)];
  };
  let who = 0;   // the person being posed
  const place = (im: THREE.InstancedMesh, _i: number, x: number, y: number, z: number, yaw: number, pitch = 0, s = 1, sy = 1) => {
    e.set(pitch, yaw, 0, 'YXZ'); q.setFromEuler(e);
    im.setMatrixAt(im.count, m.compose(t.set(x, y, z), q, sc.set(s, s * sy, s)));
    im.setColorAt(im.count, cols[who]!.get(im)!);
    im.count++;
  };

  const step = (dt: number, cx: number, cz: number, night = 0) => {
    for (const im of PARTS) im.count = 0;
    people.forEach((p, i) => {
      who = i;

      if (p.pause > 0) p.pause -= dt;
      else {
        p.s += p.dir * p.v * dt;
        if (p.s <= 0 || p.s >= p.L) { p.dir = p.dir === 1 ? -1 : 1; p.off = -p.off; p.s = Math.max(0, Math.min(p.L, p.s)); }
        p.phase += dt * p.v / 0.7 * Math.PI;
        // now and then someone stops: a look in a window, a word
        if (Math.random() < dt * 0.01) p.pause = 3 + Math.random() * 12;
      }
      const [x, z, h] = at(p, p.s);
      // after dark most go home: one in six still about (soldiers last)
      const home = night > 0.5 && i % (p.kind === 'soldier' ? 3 : 6) !== 0;
      if (home || (x - cx) ** 2 + (z - cz) ** 2 > 300 ** 2) return;
      const yaw = h + (p.dir === 1 ? 0 : Math.PI);
      const walking = p.pause <= 0 ? 1 : 0;
      const swing = Math.sin(p.phase) * 0.42 * walking, bob = Math.abs(Math.cos(p.phase)) * 0.025 * walking;
      const g = heightAt(x, z), H = p.h;
      const hip = g + 0.87 * H + bob;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      // sideways offsets (right of the walking direction)
      const side = (d: number): [number, number] => [cy * d, -sy * d];
      let shoulder: number, neck: number;
      if (p.kind === 'woman') {
        const waist = g + 1.0 * H + bob * 0.5;
        place(skirt, i, x, waist - 0.05 * H, z, yaw, 0, H);
        place(bodice, i, x, waist, z, yaw, 0, H);
        shoulder = waist + 0.44 * H; neck = waist + 0.5 * H;
      } else {
        const [lx, lz] = side(0.095 * H);
        place(legL, i, x + lx, hip, z + lz, yaw, swing, H);
        place(legR, i, x - lx, hip, z - lz, yaw, -swing, H);
        place(coat, i, x, hip, z, yaw, 0, H);
        shoulder = hip + 0.56 * H; neck = hip + 0.63 * H;
      }
      const [ax, az] = side((p.kind === 'woman' ? 0.2 : 0.235) * H);
      place(armL, i, x + ax, shoulder, z + az, yaw, -swing * 0.7, H);
      place(armR, i, x - ax, shoulder, z - az, yaw, swing * 0.7, H);
      place(head, i, x, neck, z, yaw, 0, H);
      const hy = neck + 0.23 * H;
      if (p.kind === 'soldier') {
        // the Pickelhaube: a low rounded crown, a short peak, the spike
        place(hat, i, x, hy - 0.03, z, yaw, 0, H * 1.15, 0.6);
        place(brim, i, x, hy - 0.02, z, yaw, 0, H * 0.75);
        place(spike, i, x, hy + 0.08 * H, z, yaw, 0, H);
      } else {
        place(hat, i, x, hy, z, yaw, 0, H * (p.kind === 'woman' ? 0.85 : 1), p.kind === 'woman' ? 0.6 : 1);
        place(brim, i, x, hy + 0.005, z, yaw, 0, H * (p.kind === 'woman' ? 1.45 : 1));
      }
    });
    // upload only the slots in use
    for (const im of PARTS) {
      if (!im.count) continue;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, im.count * 16); im.instanceMatrix.needsUpdate = true;
      const c = im.instanceColor!;
      c.clearUpdateRanges(); c.addUpdateRange(0, im.count * 3); c.needsUpdate = true;
    }
  };
  // where each is, for the probe
  const where = (i: number): [number, number] => { const p = people[i]!; const [x, z] = at(p, p.s); return [x, z]; };
  return { group, step, people, where };
}
