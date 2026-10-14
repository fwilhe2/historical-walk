import * as THREE from 'three';
import { heightAt } from './terrain';
import type { City } from './types';

/* ── People ─────────────────────────────────────────────────────
   Townspeople of 1900 on the pavements: men in dark frock coats under
   top hats or bowlers, women in long skirts and jackets with hats, and
   — Potsdam was a garrison town — soldiers in Prussian blue with the
   spiked helmet. Each walks one street of the year at 1.1–1.5 m/s on
   one side, turning back at its ends; some stand a while.

   Figures are a few instanced parts each (legs or skirt, body, head,
   hat, helmet spike), posed per frame: a walk sways the body and swings
   the legs. Only the figures within 300 m are drawn; the rest still
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

  // parts: [geometry, material colour per kind or per person]
  const cloth = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a98a, roughness: 0.7 });
  const n = people.length;
  const mk = (g: THREE.BufferGeometry, m: THREE.Material) => { const im = new THREE.InstancedMesh(g, m, n); im.castShadow = true; im.frustumCulled = false; group.add(im); return im; };
  const legL = mk(new THREE.BoxGeometry(0.14, 0.82, 0.16).translate(0, -0.41, 0), cloth);
  const legR = mk(new THREE.BoxGeometry(0.14, 0.82, 0.16).translate(0, -0.41, 0), cloth);
  const skirt = mk(new THREE.CylinderGeometry(0.16, 0.34, 0.92, 10).translate(0, 0.46, 0), cloth);
  const body = mk(new THREE.CylinderGeometry(0.17, 0.2, 0.62, 8).translate(0, 0.31, 0), cloth);
  const head = mk(new THREE.SphereGeometry(0.11, 10, 8), skin);
  const hat = mk(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 10).translate(0, 0.09, 0), cloth);
  const brim = mk(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 12), cloth);
  const spike = mk(new THREE.ConeGeometry(0.025, 0.12, 6).translate(0, 0.06, 0), new THREE.MeshStandardMaterial({ color: 0xc9b26a, metalness: 0.8, roughness: 0.3 }));

  const COAT: Record<Kind, number[]> = {
    man: [0x2a2a2e, 0x3a3128, 0x23262c, 0x46403a, 0x2d2a26],
    woman: [0x4a2e2e, 0x2e3a4a, 0x3a3a3a, 0x5a4a3a, 0x2e2a3a, 0x6a5a48],
    soldier: [0x1f2a4a],
  };
  const col = new THREE.Color();
  people.forEach((p, i) => {
    const pal = COAT[p.kind];
    const c = pal[Math.floor(r() * pal.length)]!;
    for (const im of [legL, legR, skirt, body]) im.setColorAt(i, col.setHex(c));
    hat.setColorAt(i, col.setHex(p.kind === 'soldier' ? 0x15151a : p.kind === 'woman' ? [0x5a3a2a, 0x2a2a2a, 0x7a6a50][Math.floor(r() * 3)]! : 0x18181a));
    brim.setColorAt(i, col.setHex(p.kind === 'soldier' ? 0x15151a : 0x18181a));
  });

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), t = new THREE.Vector3();
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  const at = (p: Person, s: number): [number, number, number] => {
    s = Math.max(0, Math.min(p.L, s));
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i]! < s) i++;
    const a = (s - p.cum[i - 1]!) / Math.max(1e-6, p.cum[i]! - p.cum[i - 1]!);
    const ax = p.pts[2 * i - 2]!, az = p.pts[2 * i - 1]!, bx = p.pts[2 * i]!, bz = p.pts[2 * i + 1]!;
    const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L;
    return [ax + (bx - ax) * a + nx * p.off, az + (bz - az) * a + nz * p.off, Math.atan2(bx - ax, bz - az)];
  };
  const place = (im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, yaw: number, pitch = 0, s = 1) => {
    e.set(pitch, yaw, 0, 'YXZ'); q.setFromEuler(e);
    im.setMatrixAt(i, m.compose(t.set(x, y, z), q, sc.set(s, s, s)));
  };

  const step = (dt: number, cx: number, cz: number, night = 0) => {
    people.forEach((p, i) => {

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
      if (home || (x - cx) ** 2 + (z - cz) ** 2 > 300 ** 2) { for (const im of [legL, legR, skirt, body, head, hat, brim, spike]) im.setMatrixAt(i, hide); return; }
      const yaw = h + (p.dir === 1 ? 0 : Math.PI);
      const walking = p.pause <= 0 ? 1 : 0;
      const swing = Math.sin(p.phase) * 0.45 * walking, bob = Math.abs(Math.cos(p.phase)) * 0.025 * walking;
      const g = heightAt(x, z), H = p.h;
      const hip = g + 0.86 * H + bob;
      const sx = Math.cos(yaw) * 0.09, sz = -Math.sin(yaw) * 0.09;
      if (p.kind === 'woman') {
        place(skirt, i, x, g, z, yaw, 0, H);
        legL.setMatrixAt(i, hide); legR.setMatrixAt(i, hide);
      } else {
        skirt.setMatrixAt(i, hide);
        place(legL, i, x + sx, hip, z + sz, yaw, swing, H);
        place(legR, i, x - sx, hip, z - sz, yaw, -swing, H);
      }
      place(body, i, x, (p.kind === 'woman' ? g + 0.9 * H : hip) + bob * 0.5, z, yaw, 0, H);
      const top = (p.kind === 'woman' ? g + 0.9 * H : hip) + 0.62 * H + bob;
      place(head, i, x, top + 0.13 * H, z, yaw, 0, H);
      const hy = top + 0.21 * H;
      if (p.kind === 'soldier') {
        place(hat, i, x, hy, z, yaw, 0, H * 1.05);
        place(brim, i, x, hy, z, yaw, 0, H * 0.75);
        place(spike, i, x, hy + 0.17 * H, z, yaw, 0, H);
      } else {
        place(hat, i, x, hy, z, yaw, 0, H * (p.kind === 'woman' ? 0.8 : 1));
        place(brim, i, x, hy + 0.005, z, yaw, 0, H * (p.kind === 'woman' ? 1.25 : 1));
        spike.setMatrixAt(i, hide);
      }
    });
    for (const im of [legL, legR, skirt, body, head, hat, brim, spike]) im.instanceMatrix.needsUpdate = true;
  };
  // where each is, for the probe
  const where = (i: number): [number, number] => { const p = people[i]!; const [x, z] = at(p, p.s); return [x, z]; };
  return { group, step, people, where };
}
