import * as THREE from 'three';
import earcut from 'earcut';
import { heightAt } from './terrain';
import type { City } from './types';

/* ── Walls and street furniture ───────────────────────────────────
   Walls: the town's wall and garden walls, as plastered boxes along
   their lines with a coping; railings, columns, lanterns, rails, the
   woods beyond the town, advertising columns and pumps. (Trees are
   in trees.ts.) */

export function buildWalls(city: City) {
  const group = new THREE.Group();
  group.name = 'walls';
  const solid = city.walls.filter((w) => w.kind === 'city' || w.kind === 'garden'), rails = city.walls.filter((w) => w.kind === 'railing');
  const mat = weatheredWall(0xbdae94, false);
  const walls = new THREE.Mesh(wallGeometry(solid, true), mat);
  walls.castShadow = walls.receiveShadow = true;
  const sand = weatheredWall(0xc9bc9e, true);
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

/* A wall's face, in wall coordinates (u along, y up): render over
   brick, or dressed sandstone blocks; a coping along the top in the
   last 25 cm; the foot damp and splashed; rain run down from the
   coping in streaks; on rendered walls patches where the render has
   come away and the brick shows; and the surface's own unevenness. */
function weatheredWall(colour: number, blocks: boolean) {
  const m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.95, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWl;\nvarying vec3 vWlN;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvWl = uv; vWlN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vWl;
      varying vec3 vWlN;
      vec3 wlBump = vec3(0.0);
      float wH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float wN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(wH(i), wH(i + vec2(1, 0)), f.x), mix(wH(i + vec2(0, 1)), wH(i + vec2(1, 1)), f.x), f.y); }
      float wF(vec2 p) { return 0.5 * wN(p) + 0.25 * wN(p * 2.1 + 3.0) + 0.125 * wN(p * 4.3 + 7.0) + 0.0625 * wN(p * 8.9 + 1.0); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float u = vWl.x, y = vWl.y;
        bool topFace = abs(vWlN.y) > 0.5;
        vec3 c = diffuseColor.rgb * (0.85 + 0.25 * wF(vec2(u, y) * 0.3));
        ${blocks ? `
        // dressed blocks, 40 cm courses, 90 cm long, fine joints
        float row = floor(y / 0.4), bx = u / 0.9 + 0.5 * mod(row, 2.0);
        c *= 0.88 + 0.2 * wH(vec2(floor(bx), row));
        float jt = 1.0 - smoothstep(0.0, 0.02, min(min(fract(y / 0.4), 1.0 - fract(y / 0.4)) * 0.4, min(fract(bx), 1.0 - fract(bx)) * 0.9));
        c *= 1.0 - 0.35 * jt;` : `
        // where the render has come away: brick in courses, darker, redder
        float lf = wF(vec2(u * 0.35, y * 0.5) + 17.0) + 0.12 * wN(vec2(u, y) * 9.0);
        float loss = smoothstep(0.67, 0.685, lf) * (1.0 - smoothstep(2.0, 3.6, y));
        // the render's broken edge stands a little proud and casts a rim
        float rim = smoothstep(0.63, 0.67, lf) * (1.0 - loss);
        float br = floor(y / 0.075), bx = u / 0.25 + 0.5 * mod(br, 2.0);
        vec3 brick = vec3(0.2, 0.085, 0.05) * (0.65 + 0.5 * wH(vec2(floor(bx), br)));
        float mort = max(step(fract(y / 0.075), 0.15), step(fract(bx), 0.06));
        c *= 1.0 - 0.15 * rim;
        c = mix(c, mix(brick, vec3(0.16, 0.15, 0.13), mort), loss);`}
        // the coping, its stones or tiles darker
        float top = vWl.y;
        if (topFace) c = diffuseColor.rgb * vec3(0.55, 0.5, 0.46) * (0.8 + 0.3 * wN(vec2(u * 2.0, 0.0)));
        // rain from the coping, in streaks; the foot damp and green
        float run = wN(vec2(u * 3.1, 0.0)) * wN(vec2(u * 0.7, y * 0.2)) * smoothstep(0.0, 1.5, top);
        c *= 1.0 - 0.45 * run * smoothstep(0.3, 0.8, wF(vec2(u * 0.6, 3.0)));
        float foot = 1.0 - smoothstep(0.15, 0.9 + 0.6 * wN(vec2(u * 1.3, 2.0)), y);
        c = mix(c, c * vec3(0.42, 0.46, 0.38), foot * (topFace ? 0.0 : 0.85));
        c *= 0.8 + 0.2 * smoothstep(0.3, 0.7, wF(vec2(u, y) * 0.12 + 5.0));
        diffuseColor.rgb = c;
        // the surface's unevenness (in the wall's frame: along u, up y)
        float b0 = wN(vec2(u, y) * 6.0) * 0.008, b1 = wN((vec2(u, y) + vec2(0.01, 0.0)) * 6.0) * 0.008, b2 = wN((vec2(u, y) + vec2(0.0, 0.01)) * 6.0) * 0.008;
        vec3 wn = normalize(vWlN), wt = vec3(-wn.z, 0.0, wn.x);
        wlBump = topFace ? vec3(0.0) : -(wt * (b1 - b0) + vec3(0.0, 1.0, 0.0) * (b2 - b0)) / 0.01;`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(wlBump, 0.0)).xyz * (gl_FrontFacing ? 1.0 : -1.0));');
  };
  m.customProgramCacheKey = () => blocks ? 'wall-blocks' : 'wall-render';
  return m;
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
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(1.0, 0.82, 0.55) * uGlow * 3.0;');
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
   gauge, 1435 mm. A rail's head, worn bright by the wheels, is some
   5 cm across; the grooved tram rail's groove beside it is drawn by
   the ground's dirt. */
export function buildRails(city: City) {
  const pos: number[] = [], nrm: number[] = [];
  const G = 1.435 / 2, W = 0.026;
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
  const mat = new THREE.MeshStandardMaterial({ color: 0x5f6164, roughness: 0.38, metalness: 0.85, side: THREE.DoubleSide,
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

/* Street furniture: advertising columns, their drum pasted with bills
   (a canvas of coloured sheets and lines of type), under a fluted cap
   and finial; and cast-iron pumps, dark green, with a lion's-head
   spout and a handle. */
function billTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#d9cfb4'; g.fillRect(0, 0, 512, 256);
  const papers = ['#e8dcb8', '#f2e6c8', '#c9a86a', '#d27b54', '#7c9bb5', '#e3c56a', '#b8c2a0', '#efe9dc'];
  for (let i = 0; i < 26; i++) {
    const w = 50 + rnd() * 90, h = 40 + rnd() * 110, x = rnd() * 512 - 20, y = rnd() * 256 - 20;
    g.fillStyle = papers[Math.floor(rnd() * papers.length)]!;
    g.fillRect(x, y, w, h);
    g.fillStyle = rnd() < 0.5 ? '#2a2420' : '#8a2a20';
    for (let l = 0; l < 5; l++) {
      const lw = w * (0.4 + rnd() * 0.5), lh = l === 0 ? 9 : 4;
      g.fillRect(x + (w - lw) / 2, y + 10 + l * (h - 20) / 5, lw, lh);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function buildFixtures(city: City) {
  const group = new THREE.Group();
  group.name = 'fixtures';
  const cols = city.fixtures.filter((f) => f.kind === 'column'), pumps = city.fixtures.filter((f) => f.kind === 'pump');
  const m = new THREE.Matrix4();
  const inst = (g: THREE.BufferGeometry, mat: THREE.Material, list: typeof cols) => {
    const im = new THREE.InstancedMesh(g, mat, Math.max(1, list.length));
    im.count = list.length;
    list.forEach((f, i) => im.setMatrixAt(i, m.makeTranslation(f.x, heightAt(f.x, f.z), f.z)));
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
  };
  const green = new THREE.MeshStandardMaterial({ color: 0x2f4a36, roughness: 0.6, metalness: 0.3 });
  const bills = new THREE.MeshStandardMaterial({ map: billTexture(), roughness: 0.9 });
  inst(new THREE.CylinderGeometry(0.62, 0.62, 2.5, 20, 1, true).translate(0, 1.55, 0), bills, cols);
  inst(new THREE.CylinderGeometry(0.7, 0.72, 0.3, 20).translate(0, 0.15, 0), green, cols);
  inst(new THREE.CylinderGeometry(0.66, 0.66, 0.22, 20).translate(0, 2.9, 0), green, cols);
  inst(new THREE.SphereGeometry(0.66, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 3.0, 0), green, cols);
  inst(new THREE.ConeGeometry(0.08, 0.5, 8).translate(0, 3.85, 0), green, cols);
  // the pump: a fluted post, a spout, a curved handle (a half torus)
  inst(new THREE.CylinderGeometry(0.16, 0.22, 1.9, 10).translate(0, 0.95, 0), green, pumps);
  inst(new THREE.ConeGeometry(0.2, 0.45, 10).translate(0, 2.1, 0), green, pumps);
  inst(new THREE.CylinderGeometry(0.045, 0.045, 0.4, 6).rotateX(Math.PI / 2).translate(0, 1.1, 0.3), green, pumps);
  inst(new THREE.TorusGeometry(0.4, 0.03, 6, 12, Math.PI).rotateY(Math.PI / 2).translate(0, 1.6, -0.35), green, pumps);
  return group;
}
