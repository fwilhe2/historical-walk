import * as THREE from 'three';
import { heightAt } from './terrain';
import type { City } from './types';

/* ── Trees ──────────────────────────────────────────────────────
   Each tree is grown from a seed: a trunk that leans a little and
   forks into limbs, the limbs into branches, and at every branch's
   end a clump of leaf cards — so a crown has lobes and gaps, light
   on its outer leaves and dark inside, and the limbs show under it.
   A few such trees (VARIANTS) are grown once, in a unit space (height
   1, crown radius 1), and every tree of the town is one of them,
   scaled to its own height and spread and turned.

   The leaves are drawn at their size: a linden's or a chestnut's leaf
   is 8–10 cm, a card a metre or so, so a card holds a hundred-odd
   leaves in clusters. Its mipmaps keep the share of the card the
   leaves cover (alpha is raised level by level), so crowns do not
   thin out with distance.

   Two levels of detail: trees within NEAR metres get every branch and
   small cards; the rest fewer, larger cards and only the limbs.
   Which trees are near is re-sorted twice a second as you walk. */

const VARIANTS = 4, NEAR = 90;
// The unit tree is A crown radii tall; a tree of the data is scaled by
// its crown radius across and by its height over A up, so leaves keep
// about their shape.
const A = 3.2;

type V3 = [number, number, number];
interface Seg { a: V3; b: V3; r0: number; r1: number; level: number }
interface Clump { p: V3; r: number }
interface Skeleton { segs: Seg[]; clumps: Clump[]; trunkH: number; c: V3; R: V3 }

function rng(seed: number) { return () => ((seed = (seed * 48271) % 2147483647) / 2147483647); }
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* The skeleton, in unit space: x and z in crown radii, y up from the
   foot (grown to a top at 1, then stretched to A). The crown is an
   ellipsoid round c with radii R. */
function grow(seed: number): Skeleton {
  const rnd = rng(seed * 7919 + 13);
  const trunkH = 0.33 + rnd() * 0.1;
  const c: V3 = [0, trunkH + (1 - trunkH) * 0.5, 0];
  const R: V3 = [1, (1 - trunkH) * 0.52, 1];
  const segs: Seg[] = [], clumps: Clump[] = [];
  // the trunk, in three pieces that lean and bend a little
  const lean: V3 = [(rnd() - 0.5) * 0.08, 0, (rnd() - 0.5) * 0.08];
  let p: V3 = [0, 0, 0];
  const TR = 0.05;
  for (let k = 1; k <= 3; k++) {
    const q: V3 = [lean[0] * k / 3 + (rnd() - 0.5) * 0.02, trunkH * k / 3, lean[2] * k / 3 + (rnd() - 0.5) * 0.02];
    segs.push({ a: p, b: q, r0: TR * (k === 1 ? 1.25 : 1 - (k - 1) * 0.12), r1: TR * (1 - k * 0.12), level: 0 });
    p = q;
  }
  const fork = p;
  // a leader on up through the middle of the crown
  const top: V3 = [c[0] + (rnd() - 0.5) * 0.2, c[1] + R[1] * 0.65, c[2] + (rnd() - 0.5) * 0.2];
  segs.push({ a: fork, b: lerp(fork, top, 0.5), r0: TR * 0.62, r1: TR * 0.45, level: 1 });
  segs.push({ a: lerp(fork, top, 0.5), b: top, r0: TR * 0.45, r1: TR * 0.2, level: 1 });
  clumps.push({ p: top, r: 0.42 });
  // limbs out and up from the fork, each ending in branches
  const n = 4 + Math.floor(rnd() * 3);
  const a0 = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const az = a0 + (i + (rnd() - 0.5) * 0.5) / n * Math.PI * 2;
    const el = -0.15 + rnd() * 0.75;     // where on the crown's shell the limb heads, by elevation
    const shell: V3 = [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)];
    const reach = 0.5 + rnd() * 0.2;
    const tip: V3 = [c[0] + shell[0] * R[0] * reach, c[1] + shell[1] * R[1] * reach, c[2] + shell[2] * R[2] * reach];
    const mid: V3 = add(lerp(fork, tip, 0.45), [0, (1 - trunkH) * 0.06, 0]);
    segs.push({ a: fork, b: mid, r0: TR * 0.62, r1: TR * 0.42, level: 1 });
    segs.push({ a: mid, b: tip, r0: TR * 0.42, r1: TR * 0.25, level: 1 });
    // branches from the limb's tip out to the clumps round it
    const nb = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < nb; k++) {
      const d = norm(add(shell, [(rnd() - 0.5) * 1.2, (rnd() - 0.3) * 0.9, (rnd() - 0.5) * 1.2]));
      const out = 0.78 + rnd() * 0.18;
      const cp: V3 = [c[0] + d[0] * R[0] * out, c[1] + d[1] * R[1] * out, c[2] + d[2] * R[2] * out];
      const from = k === 0 ? tip : lerp(mid, tip, 0.4 + rnd() * 0.5);
      segs.push({ a: from, b: cp, r0: TR * 0.24, r1: TR * 0.08, level: 2 });
      clumps.push({ p: cp, r: 0.3 + rnd() * 0.14 });
    }
    // and one clump on the limb itself, filling the crown's inside
    clumps.push({ p: lerp(mid, tip, 0.7), r: 0.32 });
  }
  const tall = (v: V3): V3 => [v[0], v[1] * A, v[2]];
  for (const sg of segs) { sg.a = tall(sg.a); sg.b = tall(sg.b); }
  for (const cl of clumps) cl.p = tall(cl.p);
  return { segs, clumps, trunkH, c: tall(c), R: tall(R) };
}

/* Wood: tapered tubes along the segments (u round, v along, in metres
   of a 10 m tree, for the bark's furrows). */
function woodGeometry(sk: Skeleton, maxLevel: number) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  for (const s of sk.segs) {
    if (s.level > maxLevel) continue;
    const sides = s.level === 0 ? 7 : s.level === 1 ? 5 : 4;
    const ax = norm([s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]]);
    const ref: V3 = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm([ax[1] * ref[2] - ax[2] * ref[1], ax[2] * ref[0] - ax[0] * ref[2], ax[0] * ref[1] - ax[1] * ref[0]]);
    const w: V3 = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
    const L = len([s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]]);
    for (let k = 0; k < sides; k++) {
      const t0 = k / sides * Math.PI * 2, t1 = (k + 1) / sides * Math.PI * 2;
      const d0: V3 = [u[0] * Math.cos(t0) + w[0] * Math.sin(t0), u[1] * Math.cos(t0) + w[1] * Math.sin(t0), u[2] * Math.cos(t0) + w[2] * Math.sin(t0)];
      const d1: V3 = [u[0] * Math.cos(t1) + w[0] * Math.sin(t1), u[1] * Math.cos(t1) + w[1] * Math.sin(t1), u[2] * Math.cos(t1) + w[2] * Math.sin(t1)];
      const quad: [V3, V3, number, number][] = [[s.a, d0, s.r0, 0], [s.b, d1, s.r1, 1], [s.b, d0, s.r1, 1], [s.a, d0, s.r0, 0], [s.a, d1, s.r0, 0], [s.b, d1, s.r1, 1]];
      quad.forEach(([base, d, r, along], q) => {
        pos.push(base[0] + d[0] * r, base[1] + d[1] * r, base[2] + d[2] * r);
        nrm.push(d[0], d[1], d[2]);
        const ku = q === 1 || q === 4 || q === 5 ? k + 1 : k;
        uv.push(ku / sides, along * L * 10);
      });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/* Leaves: cards in every clump, turned every way, sized s; their
   normals lean out of the clump and out of the crown, so the crown
   shades as a lobed volume. Deep and low cards see less sky: a vertex
   colour darkens them. */
function crownGeometry(sk: Skeleton, seed: number, perClump: number, size: number) {
  const rnd = rng(seed * 104729 + 7);
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], col: number[] = [];
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3(), o = new THREE.Vector3();
  for (const cl of sk.clumps) {
    for (let i = 0; i < perClump; i++) {
      do { v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); } while (v.lengthSq() > 1);
      // biased to the clump's outside, where the leaves are
      v.multiplyScalar(Math.pow(v.length(), -0.4) * cl.r);
      const P = new THREE.Vector3(cl.p[0] + v.x, cl.p[1] + v.y * 0.8, cl.p[2] + v.z);
      a.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      b.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(a).normalize();
      const s = size * (0.8 + rnd() * 0.4);
      // the crown's outward direction and depth, in its ellipsoid's measure
      o.set((P.x - sk.c[0]) / sk.R[0], (P.y - sk.c[1]) / sk.R[1], (P.z - sk.c[2]) / sk.R[2]);
      const depth = o.length();
      const outward = o.clone().normalize();
      n.copy(v).normalize().multiplyScalar(0.45).addScaledVector(outward, 0.75).normalize();
      const ao = 0.3 + 0.7 * THREE.MathUtils.smoothstep(depth * 0.85 + outward.y * 0.3 + v.length() / cl.r * 0.25, 0.25, 1.15);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
      const Q = corners.map(([p, q]) => P.clone().addScaledVector(a, p * s).addScaledVector(b, q * s));
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const p = Q[k]!;
        pos.push(p.x, p.y, p.z);
        nrm.push(n.x, n.y, n.z);
        uv.push((corners[k]![0] + 1) / 2, (corners[k]![1] + 1) / 2);
        col.push(ao, ao, ao);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/* A card of leaves on a transparent canvas: clusters of five to eight
   leaves on short twigs, each leaf heart-shaped with a pointed tip, a
   midrib and a lighter upper half, in the greens of a summer tree, a
   few yellowing. Then the mipmaps, each level's alpha raised until it
   covers as much as the full-size card. */
function leafTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rnd = rng(31);
  for (let cl = 0; cl < 58; cl++) {
    // a cluster somewhere in the rounded card
    let x0 = 0, y0 = 0;
    do { x0 = 90 + rnd() * (S - 180); y0 = 90 + rnd() * (S - 180); } while (((x0 - S / 2) ** 2 + (y0 - S / 2) ** 2) > (S * 0.42) ** 2);
    const twigA = rnd() * Math.PI * 2;
    g.strokeStyle = 'rgba(58,46,34,0.95)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x0 - Math.cos(twigA) * 70, y0 - Math.sin(twigA) * 70); g.lineTo(x0, y0); g.stroke();
    const nl = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < nl; i++) {
      const ang = twigA + (i / nl - 0.5) * 2.6 + (rnd() - 0.5) * 0.4;
      const L = 46 + rnd() * 26, W = L * (0.62 + rnd() * 0.15);
      const l = 0.45 + rnd() * 0.55, yel = rnd() < 0.05 ? 1 : 0;
      const r = Math.round(30 * l + 16 + yel * 70), gg = Math.round(58 * l + 30 + yel * 45), bb = Math.round(16 * l + 8);
      g.save();
      g.translate(x0 + Math.cos(ang) * (L * 0.62), y0 + Math.sin(ang) * (L * 0.62));
      g.rotate(ang + (rnd() - 0.5) * 0.5);
      // the stalk back to the twig
      g.strokeStyle = 'rgba(70,64,30,0.9)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-L * 0.62, 0); g.lineTo(-L * 0.5, 0); g.stroke();
      const leaf = () => {
        g.beginPath();
        g.moveTo(-L * 0.5, 0);
        g.bezierCurveTo(-L * 0.6, -W * 0.7, L * 0.15, -W * 0.65, L * 0.5, 0);
        g.bezierCurveTo(L * 0.15, W * 0.65, -L * 0.6, W * 0.7, -L * 0.5, 0);
      };
      leaf(); g.fillStyle = `rgb(${r},${gg},${bb})`; g.fill();
      g.save(); leaf(); g.clip();
      g.fillStyle = `rgba(255,255,210,${0.06 + rnd() * 0.08})`; g.fillRect(-L, -W, 2 * L, W);
      g.restore();
      g.strokeStyle = `rgba(${r + 30},${gg + 30},${bb + 10},0.5)`; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-L * 0.45, 0); g.lineTo(L * 0.42, 0); g.stroke();
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  coverageMipmaps(t, c);
  return t;
}

/* Mipmaps for an alpha-tested canvas that keep its coverage: each
   level's alpha raised until as much of it passes the test (40 %) as
   of the full-size canvas, so cut-out leaves and blades do not thin
   out with distance. */
export function coverageMipmaps(t: THREE.Texture, c: HTMLCanvasElement) {
  const levels: HTMLCanvasElement[] = [c];
  const coverage = (cv: HTMLCanvasElement) => { const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i]! > 102) k++; return k / (d.length / 4); };
  const target = coverage(c);
  let prev = c;
  while (prev.width > 1 || prev.height > 1) {
    const w = Math.max(1, prev.width >> 1), hh = Math.max(1, prev.height >> 1);
    const m = document.createElement('canvas');
    m.width = w; m.height = hh;
    const mg = m.getContext('2d', { willReadFrequently: true })!;
    mg.drawImage(prev, 0, 0, w, hh);
    const img = mg.getImageData(0, 0, w, hh), d = img.data;
    // find the alpha scale that restores the coverage, by bisection
    let lo = 1, hi = 8;
    for (let it = 0; it < 12; it++) {
      const k = (lo + hi) / 2;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! * k > 102) n++;
      if (n / (d.length / 4) < target) lo = k; else hi = k;
    }
    for (let i = 3; i < d.length; i += 4) d[i] = Math.min(255, d[i]! * hi);
    mg.putImageData(img, 0, 0);
    levels.push(m);
    prev = m;
  }
  t.mipmaps = levels;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
}

// seconds, for the wind (main.ts advances it)
export const treeTime = { value: 0 };

function leafMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.7, vertexColors: true });
  // Leaves let light through: lit from behind they glow yellow-green,
  // and the shaded side of a crown still gets some of the sun.
  // The wind: each crown sways slowly, more toward its top, and its
  // leaves flutter, card by card, out of step with their neighbours.
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTreeT = treeTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTreeT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec2 ph = vec2(0.0);
          #ifdef USE_INSTANCING
          ph = instanceMatrix[3].xz;
          #endif
          float t = uTreeT, k = clamp(position.y / ${A.toFixed(1)}, 0.0, 1.0);
          float gust = 0.6 + 0.4 * sin(t * 0.21 + ph.x * 0.013) * sin(t * 0.13 + ph.y * 0.011);
          transformed.xz += vec2(sin(t * 0.7 + ph.x * 0.05), cos(t * 0.55 + ph.y * 0.05)) * 0.012 * k * k * gust;
          vec3 q = position * 7.0 + vec3(ph.x, 0.0, ph.y);
          transformed += vec3(sin(t * 3.1 + q.x + q.y), sin(t * 3.7 + q.z) * 0.6, cos(t * 2.9 + q.x * 0.7 + q.z)) * 0.0045 * gust;
        }`);
    const L = THREE.ShaderChunk.lights_fragment_begin;
    const i = L.indexOf('RE_Direct(', L.indexOf('getDirectionalLightInfo( directionalLight, directLight );'));
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', L.slice(0, i) + `
		reflectedLight.directDiffuse += directLight.color * diffuseColor.rgb * vec3(1.15, 1.3, 0.55)
			* ( 0.22 * max( 0.0, -dot( geometryNormal, directLight.direction ) ) + 0.5 * pow( max( 0.0, -dot( geometryViewDir, directLight.direction ) ), 6.0 ) );
		` + L.slice(i));
  };
  m.customProgramCacheKey = () => 'leaves';
  return m;
}

/* Bark: grey-brown, in furrows that run up the trunk, mossy toward
   the weather side's foot. */
function barkMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x5e554b, roughness: 0.95 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vB;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvB = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vB;
      float bH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float bN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(bH(i), bH(i + vec2(1, 0)), f.x), mix(bH(i + vec2(0, 1)), bH(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 bq = vec2(vB.x * 14.0, vB.y * 0.6);
        float fur = bN(vec2(bq.x + bN(bq * vec2(0.5, 1.0)) * 2.0, bq.y));
        diffuseColor.rgb *= 0.55 + 0.6 * smoothstep(0.2, 0.8, fur);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.1, 0.05), 0.35 * smoothstep(0.6, 0.0, vB.y * 0.1) * bN(vB * vec2(6.0, 0.5) + 4.0));`);
  };
  m.customProgramCacheKey = () => 'bark';
  return m;
}

export interface Trees { group: THREE.Group; update(dt: number, x: number, z: number): void }

export function buildTrees(city: City): Trees {
  const group = new THREE.Group();
  group.name = 'trees';
  const list = city.trees;
  const leaves = leafMaterial(), bark = barkMaterial();
  const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = [], variant: number[] = [];
  const q = new THREE.Quaternion(), t = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((tr, i) => {
    // the data's height and crown radius (the spread's half)
    q.setFromAxisAngle(up, (i * 2.399) % (Math.PI * 2));
    mats.push(new THREE.Matrix4().compose(t.set(tr.x, heightAt(tr.x, tr.z), tr.z), q, sc.set(tr.r, tr.h / A, tr.r)));
    // each tree its own green: some bluer, some yellower, some darker
    const k = (i * 0.618) % 1, d = (i * 0.377) % 1;
    cols.push(new THREE.Color((0.8 + 0.25 * k) * (0.8 + 0.25 * d), (0.85 + 0.15 * k) * (0.8 + 0.25 * d), (0.75 + 0.3 * (1 - k)) * (0.8 + 0.25 * d)));
    variant.push(Math.floor(((i * 0.7548776662) % 1) * VARIANTS));
  });
  interface Set { near: THREE.InstancedMesh[]; far: THREE.InstancedMesh[]; members: number[] }
  const sets: Set[] = [];
  for (let v = 0; v < VARIANTS; v++) {
    const sk = grow(v + 1);
    const members = variant.flatMap((x, i) => (x === v ? [i] : []));
    const n = Math.max(1, members.length);
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, leaf: boolean) => {
      const im = new THREE.InstancedMesh(g, m, n);
      im.count = 0;
      im.castShadow = true; im.receiveShadow = leaf;
      im.frustumCulled = false;
      if (leaf) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      group.add(im);
      return im;
    };
    sets.push({
      near: [mk(crownGeometry(sk, v, 34, 0.19), leaves, true), mk(woodGeometry(sk, 2), bark, false)],
      far: [mk(crownGeometry(sk, v + 50, 9, 0.34), leaves, true), mk(woodGeometry(sk, 1), bark, false)],
      members,
    });
  }
  let wait = 0, lx = NaN, lz = NaN;
  const place = (x: number, z: number) => {
    for (const s of sets) {
      let kn = 0, kf = 0;
      for (const i of s.members) {
        const tr = list[i]!;
        const near = (tr.x - x) ** 2 + (tr.z - z) ** 2 < NEAR * NEAR;
        const [crown, wood] = near ? s.near : s.far;
        const k = near ? kn++ : kf++;
        crown!.setMatrixAt(k, mats[i]!); wood!.setMatrixAt(k, mats[i]!);
        crown!.setColorAt(k, cols[i]!);
      }
      s.near.forEach((m) => { m.count = kn; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
      s.far.forEach((m) => { m.count = kf; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    }
  };
  return {
    group,
    update(dt, x, z) {
      // re-sort when you have walked a little, at most twice a second
      if ((wait -= dt) > 0 || (Math.hypot(x - lx, z - lz) < 8)) return;
      wait = 0.5; lx = x; lz = z;
      place(x, z);
    },
  };
}
