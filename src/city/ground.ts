import * as THREE from 'three';
import type { City, Ring } from './types';

/* ── Ground ─────────────────────────────────────────────────────
   The town plan rasterised into two RGB weight maps over the city's
   bounds (about a metre a texel), drawn with a 2D canvas so streets
   get round joins and anti-aliased edges for free:

     A.r  setts (the carriageway)      B.r  water
     A.g  slabs (the pavements)        B.g  rail ballast
     A.b  grass                        B.b  gravel (paths, squares)
     earth (yards, verges) is whatever is left.

   Everything is painted opaque in order, so at any texel the weights
   sum to at most one. The ground shader turns each weight into its
   surface, procedurally; where water wins it discards, and the river
   (city/water.ts) shows through, 1.6 m down between quay walls.

   The same pixels answer `groundAt()` for the walker, so where you
   can stand and what you see agree. */

const RES = 2048;
const SIDEWALK = 2.6;   // m each side of a street's carriageway

export type Surface = 'setts' | 'slabs' | 'grass' | 'gravel' | 'earth' | 'water' | 'rail';
export interface Ground {
  mesh: THREE.Mesh;
  isWater(x: number, z: number): boolean;
  surface(x: number, z: number): Surface;
}

export function buildGround(city: City): Ground {
  const [x0, z0, x1, z1] = city.bounds;
  const W = x1 - x0, H = z1 - z0;
  const cA = document.createElement('canvas'), cB = document.createElement('canvas');
  cA.width = cB.width = RES; cA.height = cB.height = RES;
  const a = cA.getContext('2d', { willReadFrequently: true })!, b = cB.getContext('2d', { willReadFrequently: true })!;
  const sx = RES / W, sz = RES / H;
  for (const g of [a, b]) {
    g.setTransform(sx, 0, 0, sz, -x0 * sx, -z0 * sz);
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.fillStyle = '#000'; g.fillRect(x0, z0, W, H);
  }
  type Paint = [string, string];   // colour on A, on B
  const SETTS: Paint = ['#f00', '#000'], SLABS: Paint = ['#0f0', '#000'], GRASS: Paint = ['#00f', '#000'];
  const WATER: Paint = ['#000', '#f00'], RAIL: Paint = ['#000', '#0f0'], GRAVEL: Paint = ['#000', '#00f'], EARTH: Paint = ['#000', '#000'];
  const ring = (g: CanvasRenderingContext2D, r: Ring) => {
    g.moveTo(r[0]!, r[1]!);
    for (let i = 2; i < r.length; i += 2) g.lineTo(r[i]!, r[i + 1]!);
    g.closePath();
  };
  const fill = (rs: Ring[], p: Paint) => {
    [a, b].forEach((g, i) => { g.beginPath(); for (const r of rs) ring(g, r); g.fillStyle = p[i]!; g.fill('evenodd'); });
  };
  const stroke = (r: Ring, w: number, p: Paint) => {
    [a, b].forEach((g, i) => {
      g.beginPath(); g.moveTo(r[0]!, r[1]!);
      for (let k = 2; k < r.length; k += 2) g.lineTo(r[k]!, r[k + 1]!);
      g.strokeStyle = p[i]!; g.lineWidth = w; g.stroke();
    });
  };

  const AREA: Record<string, Paint> = { park: GRASS, grass: GRASS, cemetery: GRASS, garden: GRASS, square: GRAVEL, sand: GRAVEL, rail: RAIL, yard: EARTH };
  for (const ar of city.areas) { const p = AREA[ar.kind]; if (p) fill([ar.outer, ...(ar.holes ?? [])], p); }
  const roads = city.streets.filter((s) => s.kind !== 'path' && s.kind !== 'footbridge');
  const paths = city.streets.filter((s) => s.kind === 'path' || s.kind === 'footbridge');
  for (const s of paths) stroke(s.pts, s.w, GRAVEL);
  for (const r of city.rails) if (r.kind === 'rail') stroke(r.pts, 3.2, RAIL);
  // Pavements under every street first, then every carriageway, so
  // crossings join into one paved surface.
  for (const s of roads) if (s.kind !== 'lane') stroke(s.pts, s.w, SLABS);
  for (const s of roads) stroke(s.pts, s.kind === 'lane' ? s.w : Math.max(3, s.w - 2 * SIDEWALK), SETTS);
  for (const ar of city.areas) if (ar.kind === 'water') fill([ar.outer, ...(ar.holes ?? [])], WATER);
  // Bridges over the water.
  for (const s of city.streets) if (s.kind === 'bridge' || s.kind === 'footbridge') stroke(s.pts, s.w, s.kind === 'bridge' ? SETTS : SLABS);

  const tA = new THREE.CanvasTexture(cA), tB = new THREE.CanvasTexture(cB);
  for (const t of [tA, tB]) {
    t.flipY = false; t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4; t.generateMipmaps = true;
  }
  const dA = a.getImageData(0, 0, RES, RES).data, dB = b.getImageData(0, 0, RES, RES).data;
  const texel = (x: number, z: number) => {
    const i = Math.floor((x - x0) * sx), j = Math.floor((z - z0) * sz);
    if (i < 0 || j < 0 || i >= RES || j >= RES) return -1;
    return (j * RES + i) * 4;
  };

  // The plane reaches well past the mapped bounds, as plain fields.
  const M = 1500;
  const geo = new THREE.PlaneGeometry(W + 2 * M, H + 2 * M, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x0 + W / 2, 0, z0 + H / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const uni = { tA: { value: tA }, tB: { value: tB }, uB: { value: new THREE.Vector4(x0, z0, W, H) } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GROUND_PARS)
      .replace('#include <map_fragment>', GROUND_MAP)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + gBump);');
  };
  mat.customProgramCacheKey = () => 'ground';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';

  return {
    mesh,
    isWater(x, z) { const i = texel(x, z); return i >= 0 && dB[i]! > 127; },
    surface(x, z) {
      const i = texel(x, z);
      if (i < 0) return 'earth';
      if (dB[i]! > 127) return 'water';
      const w: [number, Surface][] = [
        [dA[i]!, 'setts'], [dA[i + 1]!, 'slabs'], [dA[i + 2]!, 'grass'], [dB[i + 1]!, 'rail'], [dB[i + 2]!, 'gravel']];
      w.sort((p, q) => q[0] - p[0]);
      return w[0]![0] > 100 ? w[0]![1] : 'earth';
    },
  };
}

const GROUND_PARS = /* glsl */ `
uniform sampler2D tA, tB;
uniform vec4 uB;
varying vec3 vW;
float gH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gH(i), gH(i + vec2(1, 0)), f.x), mix(gH(i + vec2(0, 1)), gH(i + vec2(1, 1)), f.x), f.y);
}
float gF(vec2 p) { return 0.5 * gN(p) + 0.25 * gN(p * 2.03) + 0.125 * gN(p * 4.1) + 0.0625 * gN(p * 8.3); }
`;

const GROUND_MAP = /* glsl */ `
  vec2 p = vW.xz;
  vec2 tuv = (p - uB.xy) / uB.zw;
  // Wobble the lookup a little so edges between surfaces are not
  // the raster's straight lines.
  vec2 wob = (vec2(gN(p * 0.9), gN(p * 0.9 + 17.0)) - 0.5) * 0.7 / uB.zw;
  vec3 A = texture2D(tA, tuv + wob).rgb, B = texture2D(tB, tuv + wob).rgb;
  bool inside = all(greaterThanEqual(tuv, vec2(0.0))) && all(lessThanEqual(tuv, vec2(1.0)));
  if (!inside) { A = vec3(0.0, 0.0, 0.7); B = vec3(0.0); }
  if (B.r > 0.5) discard;
  // sharpen: weights to near-binary with a soft edge a few cm wide
  vec3 sA = smoothstep(0.38, 0.62, A), sB = smoothstep(0.38, 0.62, B);
  float dist = length(vW - cameraPosition);
  float aa = clamp(dist * 0.004, 0.0, 1.0);

  // granite setts in rows, joints dark, each stone its own grey
  vec2 sp = p / vec2(0.15, 0.13);
  float row = floor(sp.y);
  sp.x += gH(vec2(row, 3.0)) * 7.0;
  vec2 cell = floor(sp), f = fract(sp);
  float joint = smoothstep(0.0, 0.12 + aa, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 1.6);
  float tone = gH(cell);
  vec3 setts = mix(vec3(0.27, 0.26, 0.25), vec3(0.47, 0.44, 0.41), tone) * mix(0.55, 1.0, mix(joint, 0.82, aa));
  setts *= 0.85 + 0.3 * gF(p * 0.35);
  // large granite slabs with a mosaic strip beside them
  vec2 lp = p / vec2(1.2, 0.9);
  vec2 lf = fract(lp);
  float lj = smoothstep(0.0, 0.03 + aa * 0.2, min(min(lf.x, 1.0 - lf.x), min(lf.y, 1.0 - lf.y)));
  vec3 slabs = mix(vec3(0.5, 0.49, 0.47), vec3(0.6, 0.58, 0.55), gH(floor(lp))) * mix(0.7, 1.0, lj);
  slabs *= 0.9 + 0.2 * gF(p * 1.7);
  vec3 grass = mix(vec3(0.17, 0.24, 0.08), vec3(0.3, 0.36, 0.13), gF(p * 0.6)) * (0.85 + 0.3 * gN(p * 6.0));
  vec3 gravel = mix(vec3(0.55, 0.5, 0.42), vec3(0.66, 0.6, 0.5), gF(p * 2.5)) * (0.9 + 0.15 * gH(floor(p * 18.0)));
  vec3 earth = mix(vec3(0.33, 0.28, 0.21), vec3(0.43, 0.37, 0.28), gF(p * 0.8));
  vec3 rail = mix(vec3(0.24, 0.22, 0.2), vec3(0.34, 0.3, 0.27), gH(floor(p * 12.0)));

  float wS = sA.r, wL = sA.g * (1.0 - wS), wG = sA.b, wR = sB.g, wV = sB.b;
  float wE = max(0.0, 1.0 - wS - wL - wG - wR - wV);
  float tot = wS + wL + wG + wR + wV + wE;
  vec3 col = (setts * wS + slabs * wL + grass * wG + rail * wR + gravel * wV + earth * wE) / tot;
  float gRough = (0.85 * wS + 0.8 * wL + 0.97 * wG + 0.9 * wR + 0.95 * wV + 0.97 * wE) / tot;
  // a little relief on the setts: each stone domed
  vec3 gBump = vec3(0.0);
  if (wS > 0.01) {
    vec2 d = (f - 0.5) * vec2(0.15, 0.13);
    gBump = vec3(d.x, 0.0, d.y) * 2.2 * wS * (1.0 - aa);
    gBump = (viewMatrix * vec4(gBump, 0.0)).xyz;
  }
  diffuseColor.rgb = col;
`;
