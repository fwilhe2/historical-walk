import * as THREE from 'three';
import earcut from 'earcut';
import { heightAt } from './terrain';
import type { City } from './types';

/* ── Trees and walls ────────────────────────────────────────────
   Trees: one instanced trunk and one instanced crown, a lumpy
   icosphere (linden and chestnut were the avenue trees of Potsdam),
   sized per tree from the data. Walls: the excise wall of 1733,
   which still closed the town in 1900 (it came down 1900–1905), and
   garden walls, as plastered boxes along their lines with a coping. */

/* A sprig of leaves on a transparent canvas: the texture every leaf
   card of every crown shares. Lindens and chestnuts at 50 m read as a
   mass of small leaves with sky through it, which is what this is. */
function leafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = 'rgba(70,55,40,0.9)'; g.lineWidth = 2;
  for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(128, 250); g.lineTo(30 + rnd() * 196, 20 + rnd() * 150); g.stroke(); }
  for (let i = 0; i < 260; i++) {
    const x = 16 + rnd() * 224, y = 10 + rnd() * 220;
    const dx = x - 128, dy = y - 120;
    if (dx * dx / 1.1 + dy * dy > 118 * 118) continue;   // a rounded sprig
    const l = 0.35 + rnd() * 0.65;
    g.fillStyle = `rgb(${Math.round(70 * l + 20)},${Math.round(120 * l + 35)},${Math.round(40 * l + 10)})`;
    g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI * 2);
    g.beginPath(); g.ellipse(0, 0, 9 + rnd() * 5, 5 + rnd() * 3, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* One crown: leaf cards scattered through a unit ellipsoid, turned
   every way, with normals pointing out from the crown's centre so the
   whole crown shades like one soft volume (lit side, shaded side)
   rather than as a heap of flat cards. */
function crownGeometry() {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  let seed = 11;
  const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < 46; i++) {
    // a point in the ellipsoid, biased outward
    do { v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); } while (v.lengthSq() > 1);
    v.multiplyScalar(0.55 + 0.45 * Math.cbrt(v.length()) / Math.max(v.length(), 1e-3) * v.length());
    a.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    b.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(a).normalize();
    const s = 0.55 + rnd() * 0.3;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
    const P = corners.map(([p, q]) => v.clone().addScaledVector(a, p * s).addScaledVector(b, q * s));
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const p = P[k]!;
      pos.push(p.x, p.y, p.z);
      n.copy(p).normalize();
      nrm.push(n.x, n.y, n.z);
      uv.push((corners[k]![0] + 1) / 2, (corners[k]![1] + 1) / 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// A trunk that forks into three limbs, reaching into the crown.
function trunkGeometry() {
  const parts = [new THREE.CylinderGeometry(0.11, 0.17, 1, 7).translate(0, 0.5, 0)];
  for (let k = 0; k < 3; k++) {
    const limb = new THREE.CylinderGeometry(0.035, 0.09, 0.75, 5).translate(0, 0.375, 0);
    limb.rotateZ(0.55); limb.rotateY(k * 2.1 + 0.4); limb.translate(0, 0.92, 0);
    parts.push(limb);
  }
  const pos: number[] = [], nrm: number[] = [];
  for (const p of parts) {
    const q = p.index ? p.toNonIndexed() : p;
    pos.push(...q.attributes.position!.array); nrm.push(...q.attributes.normal!.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

export function buildTrees(city: City) {
  const group = new THREE.Group();
  group.name = 'trees';
  const n = city.trees.length;
  if (!n) return group;
  const trunk = new THREE.InstancedMesh(trunkGeometry(), new THREE.MeshStandardMaterial({ color: 0x3f342b, roughness: 0.95 }), n);
  const leaves = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85 });
  const crown = new THREE.InstancedMesh(crownGeometry(), leaves, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  const col = new THREE.Color();
  city.trees.forEach((tr, i) => {
    const trunkH = tr.h * 0.42;
    q.setFromAxisAngle(t.set(0, 1, 0), (i * 2.399) % (Math.PI * 2));
    const gy = heightAt(tr.x, tr.z);
    m.compose(t.set(tr.x, gy, tr.z), q, s.set(1 + tr.r * 0.08, trunkH, 1 + tr.r * 0.08));
    trunk.setMatrixAt(i, m);
    m.compose(t.set(tr.x, gy + trunkH + (tr.h - trunkH) * 0.45, tr.z), q, s.set(tr.r, (tr.h - trunkH) * 0.55, tr.r));
    crown.setMatrixAt(i, m);
    const k = (i * 0.618) % 1;
    crown.setColorAt(i, col.setRGB(0.62 + 0.22 * k, 0.66 + 0.14 * k, 0.5 + 0.15 * (1 - k)));
  });
  trunk.castShadow = crown.castShadow = true;
  crown.receiveShadow = true;
  group.add(trunk, crown);
  return group;
}

export function buildWalls(city: City) {
  const group = new THREE.Group();
  group.name = 'walls';
  const solid = city.walls.filter((w) => w.kind === 'city' || w.kind === 'garden'), rails = city.walls.filter((w) => w.kind === 'railing');
  const mat = new THREE.MeshStandardMaterial({ color: 0xc4b59a, roughness: 0.95, side: THREE.DoubleSide });
  const walls = new THREE.Mesh(wallGeometry(solid, true), mat);
  walls.castShadow = walls.receiveShadow = true;
  const sand = new THREE.MeshStandardMaterial({ color: 0xcfc2a4, roughness: 0.9, side: THREE.DoubleSide });
  const parapets = new THREE.Mesh(wallGeometry(city.walls.filter((w) => w.kind === 'parapet'), true), sand);
  parapets.castShadow = parapets.receiveShadow = true;
  group.add(parapets);
  // Railings: one thin sheet each, its bars cut out of it in the shader
  // (balusters every 12 cm, a top and a bottom rail, a post every 2 m).
  const rmat = new THREE.MeshStandardMaterial({ color: 0x1d1f20, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide, alphaTest: 0.5 });
  rmat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vR;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvR = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vR;')
      .replace('#include <alphatest_fragment>', `
        float bar = step(abs(fract(vR.x / 0.12) - 0.5), 0.12);
        float post = step(abs(fract(vR.x / 2.0) - 0.5), 0.022);
        float railT = step(abs(vR.y - 0.98), 0.05), railB = step(abs(vR.y - 0.12), 0.035);
        float a = max(max(bar, post), max(railT, railB));
        if (a < 0.5) discard;
      `);
  };
  rmat.customProgramCacheKey = () => 'railing';
  const railing = new THREE.Mesh(wallGeometry(rails, false), rmat);
  railing.castShadow = true;
  group.add(walls, railing);
  return group;
}

/* Boxes along wall lines (thick: with a top), or single sheets. */
function wallGeometry(list: City['walls'], thick: boolean) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], u0: number, u1: number) => {
    for (const [p, u] of [[a, [u0, a[1]!]], [b, [u0, b[1]!]], [c, [u1, c[1]!]], [a, [u0, a[1]!]], [c, [u1, c[1]!]], [d, [u1, d[1]!]]] as [number[], number[]][]) {
      pos.push(p[0]!, p[1]! + heightAt(p[0]!, p[2]!), p[2]!); nrm.push(n[0]!, n[1]!, n[2]!); uv.push(u[0]!, u[1]!);
    }
  };
  for (const w of list) {
    const r = w.pts, h = w.h, t = thick ? w.t / 2 : 0, y0 = w.base ?? 0;
    let u = 0;
    for (let i = 2; i < r.length; i += 2) {
      const ax = r[i - 2]!, az = r[i - 1]!, bx = r[i]!, bz = r[i + 1]!;
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      const nx = dz / L, nz = -dx / L;
      const ex = dx / L * t, ez = dz / L * t;
      const A = [ax - ex, az - ez], B = [bx + ex, bz + ez];
      const L1 = [A[0]! + nx * t, A[1]! + nz * t], L2 = [B[0]! + nx * t, B[1]! + nz * t];
      const R1 = [A[0]! - nx * t, A[1]! - nz * t], R2 = [B[0]! - nx * t, B[1]! - nz * t];
      quad([L1[0]!, y0, L1[1]!], [L1[0]!, h, L1[1]!], [L2[0]!, h, L2[1]!], [L2[0]!, y0, L2[1]!], [nx, 0, nz], u, u + L);
      if (thick) {
        quad([R2[0]!, y0, R2[1]!], [R2[0]!, h, R2[1]!], [R1[0]!, h, R1[1]!], [R1[0]!, y0, R1[1]!], [-nx, 0, -nz], u + L, u);
        quad([L1[0]!, h, L1[1]!], [R1[0]!, h, R1[1]!], [R2[0]!, h, R2[1]!], [L2[0]!, h, L2[1]!], [0, 1, 0], u, u + L);
      }
      u += L;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/* Columns: an instanced shaft, plinth and capital each, in sandstone. */
export function buildColumns(city: City) {
  const group = new THREE.Group();
  group.name = 'columns';
  const n = city.columns.length;
  if (!n) return group;
  const mat = new THREE.MeshStandardMaterial({ color: 0xe4d8be, roughness: 0.85 });
  const shaft = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.88, 1, 1, 16).translate(0, 0.5, 0), mat, n);
  const plinth = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, n);
  const capital = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.45, 0.95, 1, 16).translate(0, 0.5, 0), mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  city.columns.forEach((c, i) => {
    const ph = Math.min(0.6, c.h * 0.05), ch = Math.min(1.4, c.h * 0.1);
    plinth.setMatrixAt(i, m.compose(t.set(c.x, c.base, c.z), q, s.set(c.r * 2.5, ph, c.r * 2.5)));
    shaft.setMatrixAt(i, m.compose(t.set(c.x, c.base + ph, c.z), q, s.set(c.r, c.h - ph - ch, c.r)));
    capital.setMatrixAt(i, m.compose(t.set(c.x, c.base + c.h - ch, c.z), q, s.set(c.r, ch, c.r)));
  });
  for (const x of [shaft, plinth, capital]) { x.castShadow = x.receiveShadow = true; group.add(x); }
  return group;
}

/* Gas lanterns: a cast-iron post with a four-sided lantern on top,
   whose glass glows when the light goes (lampGlow, set from the sun). */
export const lampGlow = { value: 0 };
export function buildLamps(city: City) {
  const group = new THREE.Group();
  group.name = 'lamps';
  const n = city.lamps.length;
  if (!n) return group;
  const iron = new THREE.MeshStandardMaterial({ color: 0x23282a, roughness: 0.6, metalness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xd8d0b0, roughness: 0.2, emissive: 0xffb45a, emissiveIntensity: 0 });
  glass.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = lampGlow;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(1.0, 0.7, 0.35) * uGlow * 6.0;');
  };
  glass.customProgramCacheKey = () => 'lampglass';
  const parts: [THREE.BufferGeometry, THREE.Material][] = [
    [new THREE.CylinderGeometry(0.05, 0.09, 3.1, 8).translate(0, 1.55, 0), iron],
    [new THREE.CylinderGeometry(0.14, 0.17, 0.5, 8).translate(0, 0.25, 0), iron],
    [new THREE.CylinderGeometry(0.06, 0.06, 0.12, 6).translate(0, 3.12, 0), iron],
    [new THREE.CylinderGeometry(0.24, 0.14, 0.55, 4, 1).rotateY(Math.PI / 4).translate(0, 3.45, 0), glass],
    [new THREE.ConeGeometry(0.3, 0.3, 4).rotateY(Math.PI / 4).translate(0, 3.87, 0), iron],
  ];
  const m = new THREE.Matrix4();
  for (const [g, mat] of parts) {
    const inst = new THREE.InstancedMesh(g, mat, n);
    city.lamps.forEach((l, i) => inst.setMatrixAt(i, m.makeTranslation(l.x, heightAt(l.x, l.z), l.z)));
    inst.castShadow = mat === iron;
    group.add(inst);
  }
  return group;
}

/* Rails: two steel strips per track, set flush in the ground (the
   horse tram's in the setts, the railway's on its ballast). Standard
   gauge, 1435 mm. */
export function buildRails(city: City) {
  const pos: number[] = [], nrm: number[] = [];
  const G = 1.435 / 2, W = 0.035;
  for (const r of city.rails) {
    const p = r.pts;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2]!, az = p[i - 1]!, bx = p[i]!, bz = p[i + 1]!;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (const off of [-G, G]) {
        const q = (o: number) => [ax + nx * o, az + nz * o, bx + nx * o, bz + nz * o];
        const [x0, z0, x1, z1] = q(off - W), [x2, z2, x3, z3] = q(off + W);
        // two triangles facing up
        for (const [x, z] of [[x0, z0], [x3, z3], [x1, z1], [x0, z0], [x2, z2], [x3, z3]] as [number, number][]) {
          pos.push(x, 0.012 + heightAt(x, z), z); nrm.push(0, 1, 0);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const mat = new THREE.MeshStandardMaterial({ color: 0x8c8f92, roughness: 0.25, metalness: 0.9, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'rails';
  return mesh;
}

/* ── Woods beyond the town ───────────────────────────────────────
   Each wood of the region is a canopy volume: its outline stood up
   14–20 m and closed with a lid, the lid and sides lumped and mottled
   in the shader so the edge reads as tree crowns at a distance. A few
   square kilometres of forest cost a few thousand triangles; nobody
   walks into them (they are all beyond the mapped town). */
export function buildWoods(city: City) {
  const pos: number[] = [], nrm: number[] = [];
  for (const a of city.region) {
    if (a.kind !== 'wood' && a.kind !== 'park') continue;
    const r = a.outer, H = a.kind === 'park' ? 14 : 19;
    const n = r.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const ax = r[j]!, az = r[j + 1]!, bx = r[i]!, bz = r[i + 1]!;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.1) continue;
      const nx = (bz - az) / L, nz = -(bx - ax) / L;
      // the sides lean in a little toward the top, like a forest edge
      const tx = -nx * 3, tz = -nz * 3;
      for (const [x, y, z] of [[ax, 0, az], [bx, 0, bz], [bx + tx, H, bz + tz], [ax, 0, az], [bx + tx, H, bz + tz], [ax + tx, H, az + tz]] as const) {
        pos.push(x, y + heightAt(x, z), z); nrm.push(nx, 0.3, nz);
      }
    }
    const data = [...r], holes: number[] = [];
    for (const h of a.holes ?? []) { holes.push(data.length / 2); data.push(...h); }
    const tris = earcut(data, holes.length ? holes : null, 2);
    for (let t = 0; t < tris.length; t += 3) {
      for (const k of [tris[t]!, tris[t + 2]!, tris[t + 1]!]) { pos.push(data[2 * k]!, H + heightAt(data[2 * k]!, data[2 * k + 1]!), data[2 * k + 1]!); nrm.push(0, 1, 0); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2e4a1e, roughness: 0.95, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWw;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWw;
      float wH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float wN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(wH(i), wH(i + vec2(1, 0)), f.x), mix(wH(i + vec2(0, 1)), wH(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 q = vWw.xz + vec2(vWw.y * 0.7);
        float crowns = wN(q / 7.0) * 0.6 + wN(q / 2.3) * 0.4;
        diffuseColor.rgb *= 0.55 + 0.7 * crowns;
        diffuseColor.rgb *= mix(0.45, 1.0, smoothstep(0.0, 12.0, vWw.y));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 qq = vWw.xz / 6.0;
        vec3 bump = vec3(wN(qq + 0.1) - wN(qq - 0.1), 0.0, wN(qq + vec2(0.0, 0.1)) - wN(qq - vec2(0.0, 0.1))) * 2.5;
        normal = normalize(normal + (viewMatrix * vec4(bump, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'woods';
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'woods';
  return mesh;
}
