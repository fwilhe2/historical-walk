import * as THREE from 'three';
import { renderer } from '../render/renderer';
import { bakeGroundTextures } from './groundtex';
import { heightAt } from './terrain';
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
   sum to at most one. The ground starts as grass (gardens); the
   historical map's built blocks are yards of earth on top. The ground
   shader turns each weight into its surface from baked textures
   (groundtex.ts); where water wins it discards, and the river
   (city/water.ts) shows through, 1.6 m down between quay walls.

   A third raster, the street frame, is computed from the street lines
   themselves: the signed distance to the nearest carriageway's edge
   and that street's bearing. By it the shader sets the kerbstones,
   the gutter, the pavement's band of slabs between strips of mosaic,
   and lays the setts in rows across each street.

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
    // unbuilt, unpaved ground is garden: grass on A, nothing on B
    if (g === a) { g.fillStyle = '#00f'; g.fillRect(x0, z0, W, H); }
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

  // Contact shade: every footprint, blurred by a few metres, darkens
  // the ground's ambient light beside the walls (and under the eaves).
  const cC = document.createElement('canvas');
  cC.width = cC.height = RES / 2;
  const c = cC.getContext('2d')!;
  c.fillStyle = '#000'; c.fillRect(0, 0, RES / 2, RES / 2);
  c.setTransform(sx / 2, 0, 0, sz / 2, -x0 * sx / 2, -z0 * sz / 2);
  c.filter = 'blur(2px)';
  c.fillStyle = '#fff';
  c.beginPath();
  for (const bd of city.buildings) if ((bd.base ?? 0) < 2) ring(c, bd.outer);
  c.fill('nonzero');
  const tS = streetFrame(city, x0, z0, sx, sz);
  const tex = bakeGroundTextures(renderer);
  const tA = new THREE.CanvasTexture(cA), tB = new THREE.CanvasTexture(cB), tC = new THREE.CanvasTexture(cC);
  for (const t of [tA, tB, tC]) {
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

  // Beyond the bounds, the region raster: R water, G wood, B park, at
  // about 8 m a texel over the wider box.
  const [r0, q0, r1, q1] = city.regionBounds;
  const RW = r1 - r0, RH = q1 - q0, RR = 1024;
  const cR = document.createElement('canvas');
  cR.width = cR.height = RR;
  const gr = cR.getContext('2d')!;
  gr.setTransform(RR / RW, 0, 0, RR / RH, -r0 * RR / RW, -q0 * RR / RH);
  gr.fillStyle = '#000'; gr.fillRect(r0, q0, RW, RH);
  const RC: Record<string, string> = { water: '#f00', wood: '#0f0', park: '#00f' };
  for (const ar of city.region) {
    gr.beginPath();
    for (const r of [ar.outer, ...(ar.holes ?? [])]) ring(gr, r);
    gr.fillStyle = RC[ar.kind] ?? '#000';
    gr.fill('evenodd');
  }
  const tR = new THREE.CanvasTexture(cR);
  tR.flipY = false; tR.colorSpace = THREE.NoColorSpace;
  // The plane covers the region and a little more, as plain fields.
  const M = 600;
  // A 40 m grid lifted onto the terrain (flat in the town): the hills
  // are seen from a distance, where 40 m facets are fine.
  const geo = new THREE.PlaneGeometry(RW + 2 * M, RH + 2 * M, Math.ceil((RW + 2 * M) / 40), Math.ceil((RH + 2 * M) / 40));
  geo.rotateX(-Math.PI / 2);
  geo.translate(r0 + RW / 2, 0, q0 + RH / 2);
  const gp = geo.attributes.position!;
  for (let i = 0; i < gp.count; i++) gp.setY(i, heightAt(gp.getX(i), gp.getZ(i)));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const uni = { tA: { value: tA }, tB: { value: tB }, tC: { value: tC }, tR: { value: tR }, tS: { value: tS },
    tGA: { value: tex.albedo }, tGN: { value: tex.normal }, uSRes: { value: new THREE.Vector2(RES, RES) },
    uB: { value: new THREE.Vector4(x0, z0, W, H) }, uR: { value: new THREE.Vector4(r0, q0, RW, RH) } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GROUND_PARS)
      .replace('#include <map_fragment>', GROUND_MAP)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(gNrm, 0.0)).xyz);')
      // the relief's and the walls' occlusion dims the sky's light only, not the sun's
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= gAO;\nreflectedLight.indirectSpecular *= mix(1.0, gAO, 0.7);');
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

/* The street frame: R the signed distance to the nearest carriageway's
   edge (−4..4 m, negative on the carriageway), G that street's bearing
   (0..π). Exact, from the street lines as capsules of the widths the
   carriageways are painted at, unlike a distance taken from the raster. */
function streetFrame(city: City, x0: number, z0: number, sx: number, sz: number) {
  const D = new Float32Array(RES * RES).fill(4), TH = new Float32Array(RES * RES);
  for (const s of city.streets) {
    if (s.kind === 'path' || s.kind === 'footbridge') continue;
    const r = (s.kind === 'lane' ? s.w : Math.max(3, s.w - 2 * SIDEWALK)) / 2, R = r + 4;
    const p = s.pts;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2]!, az = p[i - 1]!, bx = p[i]!, bz = p[i + 1]!;
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      if (L2 < 1e-6) continue;
      const th = (Math.atan2(dz, dx) + Math.PI) % Math.PI;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - x0) * sx)), i1 = Math.min(RES - 1, Math.ceil((Math.max(ax, bx) + R - x0) * sx));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R - z0) * sz)), j1 = Math.min(RES - 1, Math.ceil((Math.max(az, bz) + R - z0) * sz));
      for (let j = j0; j <= j1; j++) {
        const z = z0 + (j + 0.5) / sz;
        for (let k = i0; k <= i1; k++) {
          const x = x0 + (k + 0.5) / sx;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
          const d = Math.hypot(ax + t * dx - x, az + t * dz - z) - r;
          const n = j * RES + k;
          if (d < D[n]!) { D[n] = d; TH[n] = th; }
        }
      }
    }
  }
  const data = new Uint8Array(RES * RES * 4);
  for (let n = 0; n < RES * RES; n++) {
    data[n * 4] = Math.round(Math.max(0, Math.min(1, (D[n]! + 4) / 8)) * 255);
    data[n * 4 + 1] = Math.round(TH[n]! / Math.PI * 255) % 256;
  }
  const t = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const GROUND_PARS = /* glsl */ `
uniform sampler2D tA, tB, tC, tR, tS;
uniform highp sampler2DArray tGA, tGN;
uniform vec4 uB, uR;
uniform vec2 uSRes;
varying vec3 vW;
float gH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gH(i), gH(i + vec2(1, 0)), f.x), mix(gH(i + vec2(0, 1)), gH(i + vec2(1, 1)), f.x), f.y);
}
float gF(vec2 p) { return 0.5 * gN(p) + 0.25 * gN(p * 2.03) + 0.125 * gN(p * 4.1) + 0.0625 * gN(p * 8.3); }
// accumulated surface: albedo + roughness, world normal + occlusion
vec4 gAcc, gNAcc;
float gAO = 1.0;
vec3 gNrm = vec3(0.0, 1.0, 0.0);
// one baked surface (layer L) at tile coordinates tc, whose x and y
// axes run along the world directions ex and ey (level)
void gAdd(float w, float L, vec2 tc, vec2 dx, vec2 dy, vec2 ex, vec2 ey) {
  if (w < 0.002) return;
  vec4 a = textureGrad(tGA, vec3(tc, L), dx, dy);
  vec4 n = textureGrad(tGN, vec3(tc, L), dx, dy);
  vec2 t = n.xy * 2.0 - 1.0;
  vec3 nw = vec3(ex.x, 0.0, ex.y) * t.x + vec3(ey.x, 0.0, ey.y) * t.y + vec3(0.0, sqrt(max(0.0, 1.0 - dot(t, t))), 0.0);
  gAcc += w * a;
  gNAcc += w * vec4(nw, n.w);
}
`;

const GROUND_MAP = /* glsl */ `
  vec2 p = vW.xz;
  vec2 tuv = (p - uB.xy) / uB.zw;
  // Wobble the lookup a little so edges between surfaces are not
  // the raster's straight lines.
  vec2 wob = (vec2(gN(p * 0.9), gN(p * 0.9 + 17.0)) - 0.5) * 0.7 / uB.zw;
  vec3 A = texture2D(tA, tuv + wob).rgb, B = texture2D(tB, tuv + wob).rgb;
  bool inside = all(greaterThanEqual(tuv, vec2(0.0))) && all(lessThanEqual(tuv, vec2(1.0)));
  float wood = 0.0;
  if (!inside) {
    vec3 R = texture2D(tR, (p - uR.xy) / uR.zw + wob * uB.zw / uR.zw * 6.0).rgb;
    A = vec3(0.0, 0.0, 0.7); B = vec3(R.r, 0.0, 0.0);
    wood = smoothstep(0.3, 0.7, R.g);
  }
  if (B.r > 0.5) discard;
  vec3 sA = smoothstep(0.38, 0.62, A), sB = smoothstep(0.38, 0.62, B);
  float wS = sA.r, wL = sA.g * (1.0 - wS), wG = sA.b, wR = sB.g, wV = sB.b;
  float wE = max(0.0, 1.0 - wS - wL - wG - wR - wV);
  float tot = wS + wL + wG + wR + wV + wE;
  wS /= tot; wL /= tot; wG /= tot; wR /= tot; wV /= tot; wE /= tot;

  // The street frame: how far to the kerb, which way the street runs.
  float kd = 4.0, th = 0.0;
  vec2 kg = vec2(0.0, 1.0);
  if (inside) {
    kd = texture2D(tS, tuv).r * 8.0 - 4.0;
    vec2 e = 0.5 / uSRes;
    kg = vec2(texture2D(tS, tuv + vec2(e.x, 0.0)).r - texture2D(tS, tuv - vec2(e.x, 0.0)).r,
              texture2D(tS, tuv + vec2(0.0, e.y)).r - texture2D(tS, tuv - vec2(0.0, e.y)).r) / (2.0 * e * uB.zw);
    kg = length(kg) > 1e-4 ? normalize(kg) : vec2(0.0, 1.0);
    // the courses of two streets meet in a ragged seam, not the raster's steps
    vec2 tw = tuv + (vec2(gN(p * 0.8), gN(p * 0.8 + 9.0)) - 0.5) * 2.0 / uB.zw;
    th = texelFetch(tS, ivec2(clamp(tw * uSRes, vec2(0.0), uSRes - 1.0)), 0).g * 3.14159265;
  }
  vec2 al = vec2(cos(th), sin(th)), ac = vec2(-al.y, al.x);
  vec2 q = vec2(dot(p, ac), dot(p, al));
  vec2 pdx = dFdx(p), pdy = dFdy(p);
  vec2 qdx = vec2(dot(pdx, ac), dot(pdx, al)), qdy = vec2(dot(pdy, ac), dot(pdy, al));
  float kdx = dFdx(kd), kdy = dFdy(kd);
  float kaa = clamp(length(vec2(kdx, kdy)), 0.004, 0.3);

  // The pavement runs up to the houses: bare earth left between a
  // street's pavement and the building line (the raster's pavement is
  // a fixed 2.6 m) is paved with mosaic too. Grass stays (front gardens).
  float upTo = wE * (1.0 - smoothstep(6.0, 7.5, kd)) * step(0.0, kd) * (inside ? 1.0 : 0.0);
  wL += upTo; wE -= upTo;
  // Paved ground: the raster says where, the frame says which side of
  // the kerb (the raster's edge is a metre coarse).
  float paved = wS + wL;
  float road = paved * (1.0 - smoothstep(-kaa, kaa, kd));
  float walk = paved - road;
  // on the road: the kerb's face (seen from above, a strip), the gutter
  // (setts laid along the kerb), and the setts in rows across
  float face = road * smoothstep(-0.13 - kaa, -0.13 + kaa, kd);
  float gut = road * smoothstep(-0.5 - kaa, -0.5 + kaa, kd) - face;
  float setts = road - face - gut;
  // on the pavement: kerbstones, mosaic, a band of slabs, mosaic again
  float kerb = walk * (1.0 - smoothstep(0.3 - kaa, 0.3 + kaa, kd));
  float band = walk * smoothstep(0.65 - kaa, 0.65 + kaa, kd) * (1.0 - smoothstep(1.95 - kaa, 1.95 + kaa, kd));
  float mos = walk - kerb - band;

  gAcc = vec4(0.0); gNAcc = vec4(0.0);
  gAdd(setts, 0.0, q / 2.4, qdx / 2.4, qdy / 2.4, ac, al);
  vec2 g2 = vec2(q.y, -kd) / 2.4;
  gAdd(gut, 0.0, g2, vec2(qdx.y, -kdx) / 2.4, vec2(qdy.y, -kdy) / 2.4, al, -kg);
  vec2 k2 = vec2(kd / 0.3, q.y / 4.0);
  gAdd(kerb + face, 1.0, k2, vec2(kdx / 0.3, qdx.y / 4.0), vec2(kdy / 0.3, qdy.y / 4.0), kg, al);
  vec2 b2 = vec2((kd - 0.65) / 1.3, q.y / 4.8);
  gAdd(band, 1.0, b2, vec2(kdx / 1.3, qdx.y / 4.8), vec2(kdy / 1.3, qdy.y / 4.8), kg, al);
  gAdd(mos, 2.0, q / 1.2, qdx / 1.2, qdy / 1.2, ac, al);
  gAdd(wV + wR, 3.0, p / 2.0, pdx / 2.0, pdy / 2.0, vec2(1.0, 0.0), vec2(0.0, 1.0));
  gAdd(wG, 4.0, p / 2.0, pdx / 2.0, pdy / 2.0, vec2(1.0, 0.0), vec2(0.0, 1.0));
  gAdd(wE, 5.0, p / 3.0, pdx / 3.0, pdy / 3.0, vec2(1.0, 0.0), vec2(0.0, 1.0));
  float wsum = max(setts + gut + kerb + face + band + mos + wV + wR + wG + wE, 1e-3);
  vec3 col = gAcc.rgb / wsum;
  float gRough = gAcc.a / wsum;
  vec3 nW = gNAcc.xyz / wsum;
  float ao = gNAcc.w / wsum;

  // the kerb's face: dressed granite turned toward the road
  if (face > 0.01) {
    nW = normalize(mix(nW, vec3(-kg.x, 0.3, -kg.y), face));
    col *= mix(1.0, 0.8, face);
  }
  // ballast is dark with soot and oil
  col *= mix(1.0, 0.5, wR);
  // the road: horse traffic darkens the middle, dust lies by the kerbs,
  // and the gutter stays damp in places, shining
  float mid = smoothstep(-0.6, -3.5, kd) * (setts / max(road, 1e-3));
  float stain = smoothstep(0.45, 0.85, gF(p * 0.45 + 3.0)) * mid;
  col = mix(col, col * vec3(0.72, 0.66, 0.56), stain * 0.65 * road);
  float dust = smoothstep(-2.5, -0.4, kd) * smoothstep(0.35, 0.7, gF(p * 0.3 + 11.0));
  col = mix(col, vec3(0.26, 0.23, 0.18) * (0.8 + 0.4 * gN(p * 9.0)), dust * 0.35 * road);
  float wet = gut * smoothstep(0.62, 0.8, gF(p * vec2(0.15, 0.15) + 5.0));
  col *= 1.0 - 0.45 * wet;
  gRough = mix(gRough, 0.12, wet);
  // paving everywhere picks up a little grime at a larger scale
  col *= 0.88 + 0.24 * gF(p * 0.06 + 1.7);
  // forest floor beyond the town: dark, needles and shade
  col = mix(col, mix(vec3(0.03, 0.045, 0.02), vec3(0.06, 0.07, 0.03), gF(p * 0.3)), wood);
  // fields beyond the town: hay-coloured, in strips
  if (!inside) col = mix(col, col * vec3(1.35, 1.15, 0.7), smoothstep(0.4, 0.6, gN(p * 0.004 + 3.0)) * (1.0 - wood));
  // beside walls the sky is half hidden (the post pass's occlusion
  // adds the close detail): the sky's light only
  float occ = texture2D(tC, tuv).r;
  gAO = ao * (1.0 - 0.35 * occ);
  // the relief on the hills: tilt by the ground's own slope
  vec3 geo = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
  gNrm = normalize(nW + vec3(geo.x, 0.0, geo.z));
  diffuseColor.rgb = col;
`;
