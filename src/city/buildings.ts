import * as THREE from 'three';
import { bbox, centroid, inside } from '../geom/poly';
import { heightAt } from './terrain';
import { buildMassing, clothBuf, metalBuf, roofBuf, wallBuf, type ClothBuf, type MetalBuf, type RoofBuf, type WallBuf } from './massing';
import { SUN_DIR, bounce, light } from '../render/sky';
import { wallSky, type HeightField } from './skyview';
import type { Building } from './types';

/* ── Buildings: meshes and materials ────────────────────────────
   Walls and roofs of every building, merged per 200 m tile so the
   frustum can cull them. The facades are drawn in the fragment
   shader from wall coordinates (metres along the wall, height): a
   stone plinth, window bays spread evenly along each wall, a door in
   the middle bay of long walls, sills and frames, a cornice under
   the eaves. Each wall carries its building's eave height, storey
   height, its own length and a seed (aFac), so the bays fit the wall
   they are on and neighbours differ. Roofs are tiled in rows up the
   slope (beaver-tail clay or slate, by vertex colour). */

const TILE = 200;

// 0 by day, 1 at night: lights in a share of the windows (main.ts sets it).
export const nightLight = { value: 0 };
// 1 tints every wall by where it came from (V).
export const sourceView = { value: 0 };

/* The shop boards' lettering: one sign a row of a canvas, white on
   black, left-aligned; each row's width over its height goes to the
   shader (signs.aspect), which centres it on the board. */
const SIGN_ROWS = 32, SIGN_H = 64, SIGN_W = 2048;
const signs = { tex: new THREE.Texture(), aspect: new Array<number>(SIGN_ROWS).fill(0), n: { value: 0 } };
function drawSigns(list: string[]) {
  const c = document.createElement('canvas');
  c.width = SIGN_W; c.height = SIGN_ROWS * SIGN_H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff'; g.textBaseline = 'middle';
  const n = Math.min(SIGN_ROWS, list.length);
  for (let i = 0; i < n; i++) {
    // serif capitals for most, a plain grotesque for some
    g.font = i % 3 === 2 ? 'bold 40px "DejaVu Sans", Arial, sans-serif' : 'bold 42px "DejaVu Serif", Georgia, "Times New Roman", serif';
    const w = Math.min(SIGN_W - 8, g.measureText(list[i]!).width);
    g.fillText(list[i]!, 4, i * SIGN_H + SIGN_H / 2 + 2, SIGN_W - 8);
    signs.aspect[i] = (w + 8) / SIGN_H;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  signs.tex = t;
  signs.n.value = n;
  facadeMat.needsUpdate = true;
}
const FACADE_PARS = /* glsl */ `
uniform float uNight;
uniform float uSrcView;
uniform vec3 uSunDir, uSunE, uSkyE, uBounce;
uniform sampler2D tSigns;
uniform float uSignA[${SIGN_ROWS}];
uniform float uSignN;
varying float vSky;
varying vec4 vFac;
varying vec2 vWall;
varying vec3 vWP;
varying vec3 vWN;
// For the lighting: the sun's share where the facade's own relief
// shades it, the sky's share, and a world normal to bend toward.
float reliefSun = 1.0, reliefAO = 1.0, reliefNW = 0.0;
vec3 reliefN = vec3(0.0, 1.0, 0.0);
// the surface's own unevenness, added to the normal after the relief
vec3 fineN = vec3(0.0);
// bend toward n with weight w, where no stronger bend is already set
void bend(vec3 n, float w) { if (w > reliefNW) { reliefN = n; reliefNW = w; } }
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), f.x), f.y); }
float fFbm(vec2 p) { return 0.5 * fNoise(p) + 0.25 * fNoise(p * 2.07 + 3.1) + 0.125 * fNoise(p * 4.13 + 7.7) + 0.0625 * fNoise(p * 8.3 + 1.3); }
// Glass: how much of what it mirrors is the houses opposite rather than
// the sky (by the open sky and how far the mirrored ray climbs), and
// how bright they are there (each pane catches a different part).
float glassK = 0.0, glassBlock = 0.0;
vec3 glassTint = vec3(1.0);
void mirrorStreet(float g, vec3 V, vec3 N, float pane) {
  vec3 R = reflect(V, N);
  glassK = max(glassK, g);
  glassBlock = max(glassBlock, g * clamp((1.0 - vSky) * 2.4 - R.y * 2.5 + 0.15, 0.0, 1.0));
  glassTint = vec3(0.55 + 0.9 * fHash(vec2(pane, 3.7)));
}
// 1 inside the box [a, b] with a soft edge of w
float fBox(vec2 p, vec2 a, vec2 b, float w) {
  vec2 s = smoothstep(a - w, a + w, p) * (1.0 - smoothstep(b - w, b + w, p));
  return s.x * s.y;
}
// 1 in the shadow a ledge throws: d out from the wall, its underside at
// height h; sp is how far the sun's ray drifts across the wall per metre
// out from it (x along, y up)
float fLedge(float y, float h, float d, vec2 sp, float w) {
  return (1.0 - smoothstep(h - w, h + w, y)) * smoothstep(h - d * sp.y - w, h - d * sp.y + w, y);
}
`;

/* The room behind a window: a box behind the glass as wide as the bay
   and as high as the storey, 4.5 m deep; the eye ray from the glass
   (G, drifting rd per metre of depth) meets its far side, a side wall,
   the floor or the ceiling. Returns albedo, dimmer the deeper. */
const ROOM = /* glsl */ `
vec3 fRoom(vec2 G, vec2 rd, vec2 lo, vec2 hi, float id) {
  float tx = rd.x > 0.0 ? (hi.x - G.x) / rd.x : rd.x < 0.0 ? (lo.x - G.x) / rd.x : 1e3;
  float ty = rd.y > 0.0 ? (hi.y - G.y) / rd.y : rd.y < 0.0 ? (lo.y - G.y) / rd.y : 1e3;
  float t = min(4.5, min(tx, ty));
  float k = fHash(vec2(id, 1.7));
  vec3 paper = k < 0.3 ? vec3(0.2, 0.22, 0.15) : k < 0.55 ? vec3(0.3, 0.16, 0.12) : k < 0.8 ? vec3(0.32, 0.26, 0.16) : vec3(0.18, 0.2, 0.26);
  vec3 c = t >= 4.5 ? paper : t == tx ? paper * 0.75 : rd.y < 0.0 ? vec3(0.07, 0.045, 0.028) : vec3(0.5, 0.48, 0.44);
  // furniture: a dark mass along the back wall's lower part
  vec2 h = G + rd * t;
  if (t >= 4.5 && h.y < lo.y + 0.9 && fHash(vec2(floor(h.x * 1.3), id)) > 0.4) c = vec3(0.06, 0.04, 0.03);
  return c / (1.0 + 0.6 * t);
}
`;

function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFac;\nattribute float aSky;\nvarying float vSky;\nvarying vec4 vFac;\nvarying vec2 vWall;\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = aFac; vSky = aSky; vWall = uv; vWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_PARS + ROOM)
      .replace('#include <map_fragment>', FACADE_MAP)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, (viewMatrix * vec4(reliefN, 0.0)).xyz, reliefNW) + (viewMatrix * vec4(fineN, 0.0)).xyz);')
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= reliefSun;'))
      // The sky the street leaves open (skyview.ts): a quarter of a wall's
      // light from the environment comes from the ground below the
      // horizon and stays; of the sky's three quarters, the share the
      // houses opposite hide is replaced by what they throw back.
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse = reflectedLight.indirectDiffuse * (0.25 + 0.75 * vSky) + (1.0 - vSky) * 0.5 * uBounce * BRDF_Lambert(material.diffuseColor);
        reflectedLight.indirectDiffuse *= reliefAO;
        reflectedLight.indirectSpecular *= mix(reliefAO * mix(0.35, 1.0, vSky), 1.0, glassK);`)
      .replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps.replace(
        'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );',
        'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );\n\t\tradiance = mix(radiance, uBounce * RECIPROCAL_PI * glassTint, glassBlock);'))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += glow;');
    sh.uniforms.uNight = nightLight;
    sh.uniforms.uSrcView = sourceView;
    sh.uniforms.tSigns = { value: signs.tex };
    sh.uniforms.uSignA = { value: signs.aspect };
    sh.uniforms.uSignN = signs.n;
    sh.uniforms.uSunDir = { value: SUN_DIR };
    sh.uniforms.uSunE = { value: light.sun };
    sh.uniforms.uSkyE = { value: light.sky };
    sh.uniforms.uBounce = { value: bounce };
  };
  m.customProgramCacheKey = () => 'facade';
  m.userData.skyView = true;
  return m;
}

/* The facade, drawn in wall coordinates (u along the wall, y up from
   its foot). Its relief is not geometry, but the shader knows it: the
   eaves and cornice, string courses, sills, window caps, pilasters and
   the reveals of the openings stand out from or into the wall by known
   depths, so where each throws its shadow in the sun is found here
   (reliefSun), and the reveals, cornice and sills bend the normal.
   Windows are sash windows behind 25 cm reveals, with glazing bars,
   lace curtains or drapes in most, and a room behind the glass. */
const FACADE_MAP = /* glsl */ `
  float u = vWall.x, y = vWall.y;
  float eave = vFac.x, storey = vFac.y, L = vFac.z;
  float flags = mod(floor(vFac.w), 128.0), seed = fract(vFac.w);
  float src = mod(floor(floor(vFac.w) / 128.0), 4.0);
  bool shop = floor(vFac.w) >= 512.0;
  bool blank = mod(flags, 2.0) >= 1.0;
  bool church = mod(floor(flags / 2.0), 2.0) >= 1.0;
  bool grand = mod(floor(flags / 4.0), 2.0) >= 1.0;
  float style = mod(floor(flags / 8.0), 8.0);
  bool ornate = flags >= 64.0;
  bool dormer = style > 3.5;
  vec3 Nw = normalize(vWN), Tw = vec3(-Nw.z, 0.0, Nw.x), UP = vec3(0.0, 1.0, 0.0);
  vec3 Ls = normalize(uSunDir);
  float lN = dot(Ls, Nw);
  // the sun's drift across the wall per metre out from it
  vec2 sp = vec2(dot(Ls, Tw), Ls.y) / max(lN, 0.03);
  float aa = max(fwidth(u), fwidth(y)) * 0.75 + 0.002;
  float sh = 0.0;      // how much of the sun the relief takes here
  vec3 glow = vec3(0.0);
  float rough = 0.92;

  // the building's colour (applied here, not by three's color chunk,
  // so sashes, curtains and stone keep their own)
  vec3 plaster = diffuseColor.rgb * vColor;
  // render patched and renewed over the years, undulating a little
  plaster *= 0.9 + 0.2 * fFbm(vec2(u, y) * 0.35 + seed * 17.0);
  plaster *= 0.96 + 0.08 * fNoise(vec2(u, y) * 6.0 + seed * 3.0);
  // soot and dust from the roofs and chimneys, run down in streaks
  float streaks = fNoise(vec2(u * 2.3, seed * 40.0)) * (0.6 + 0.4 * fNoise(vec2(u * 0.6 + 3.0, y * 0.25)));
  float top = smoothstep(eave - 4.0, eave - 0.2, y) * (0.4 + 0.6 * streaks);
  plaster *= 1.0 - 0.28 * top * smoothstep(0.25, 0.7, fFbm(vec2(u * 0.5, y * 0.1) + seed * 5.0));
  // the foot: splashed by rain, damp, a little green
  float foot = 1.0 - smoothstep(0.15, 0.9 + 0.5 * fNoise(vec2(u * 1.1, 2.0 + seed)), y);
  plaster = mix(plaster, plaster * vec3(0.66, 0.68, 0.6), foot * 0.75);
  // and everything a little greyer and darker than the paint was: a
  // coal-fired town's air settles on the render
  plaster = mix(plaster, vec3(dot(plaster, vec3(0.3, 0.55, 0.15))), 0.14) * 0.9;
  // blotches at the scale of a storey, where the lime wash was renewed
  // or has worn, a little browner or greyer
  float blot = fFbm(vec2(u, y) * 0.22 + seed * 23.0);
  plaster *= mix(vec3(1.06, 1.04, 1.0), vec3(0.86, 0.84, 0.82), smoothstep(0.35, 0.75, blot));
  // the render is trowelled, never flat: a few millimetres of relief
  // over centimetres to decimetres, which a low sun picks out (fading
  // out with distance before it could shimmer)
  float dist0 = length(vWP - cameraPosition);
  float bumpK = 1.0 - smoothstep(10.0, 35.0, dist0);
  if (bumpK > 0.0) {
    vec2 w0 = vec2(u, y) + seed * 9.0;
    float b0 = fNoise(w0 * 7.0) * 0.006 + fNoise(w0 * 29.0) * 0.0015;
    float b1 = fNoise((w0 + vec2(0.01, 0.0)) * 7.0) * 0.006 + fNoise((w0 + vec2(0.01, 0.0)) * 29.0) * 0.0015;
    float b2 = fNoise((w0 + vec2(0.0, 0.01)) * 7.0) * 0.006 + fNoise((w0 + vec2(0.0, 0.01)) * 29.0) * 0.0015;
    fineN = -(Tw * (b1 - b0) + UP * (b2 - b0)) / 0.01 * bumpK;
  }

  if (style > 0.5 && style < 1.5) {
    // brick: courses of 7.5 cm, stretchers of 25 cm, pale mortar
    float ch = 0.075, bl = 0.25;
    float row = floor(y / ch);
    float bx = u / bl + 0.5 * mod(row, 2.0);
    float tone = fHash(vec2(floor(bx), row));
    float fade = smoothstep(0.012, 0.03, aa);
    float mortar = 1.0 - smoothstep(0.0, 0.14 + aa / ch, min(fract(y / ch), 1.0 - fract(y / ch)))
                 * smoothstep(0.0, 0.06 + aa / bl, min(fract(bx), 1.0 - fract(bx)));
    vec3 b = plaster * (0.78 + 0.36 * tone);
    plaster = mix(mix(b, vec3(0.5, 0.48, 0.44), mortar * 0.8), plaster * 0.98, fade);
  } else if (style > 1.5 && style < 2.5) {
    // ashlar: courses of 60 cm, blocks of 1.2 m, fine joints
    float row = floor(y / 0.6);
    float bx = u / 1.2 + 0.5 * mod(row, 2.0);
    float tone = fHash(vec2(floor(bx), row));
    float joint = 1.0 - smoothstep(0.0, 0.025 + aa / 0.6, min(fract(y / 0.6), 1.0 - fract(y / 0.6)))
                * smoothstep(0.0, 0.012 + aa / 1.2, min(fract(bx), 1.0 - fract(bx)));
    plaster *= (0.9 + 0.14 * tone) * (1.0 - 0.3 * joint);
  } else if (style > 2.5 && !dormer) {
    // copper sheet: standing seams every 60 cm, streaks of patina
    float seam = 1.0 - smoothstep(0.0, 0.03 + aa, abs(fract(u / 0.6) - 0.5) * 0.6 - 0.27);
    plaster *= (0.9 + 0.15 * fHash(vec2(floor(u / 0.6), 3.0))) * (1.0 - 0.25 * seam);
    rough = 0.55;
  }
  vec3 col = plaster;

  // stone plinth, 60 cm, standing 3 cm proud
  if (style < 2.5) {
    float plinth = 1.0 - smoothstep(0.6 - aa, 0.6 + aa, y);
    col = mix(col, vec3(0.3, 0.29, 0.27) * (0.85 + 0.25 * fNoise(vec2(u * 3.0, y * 3.0))), plinth);
    sh = max(sh, fLedge(y, 0.6, 0.03, sp, aa) * (1.0 - plinth));
  }

  // Per-building variety, from its seed: window proportions, the head
  // of the windows (0 plain, 1 a little cornice above, 2 a segmental
  // arch), a string course at each floor, a rusticated ground storey.
  float vA = fHash(vec2(seed * 53.0, 1.7)), vB = fHash(vec2(seed * 71.0, 4.1)), vC = fHash(vec2(seed * 29.0, 8.3));
  float head = vB < 0.45 ? 0.0 : vB < 0.8 ? 1.0 : 2.0;
  bool course = vC < 0.45 || grand;
  bool rustic = (ornate || grand) && vC > 0.6 && style < 0.5;
  if (rustic && y > 0.6 && y < 0.6 + storey - 0.1) {
    float g = abs(fract((y - 0.6) / 0.42) - 0.5) * 0.42;
    float groove = 1.0 - smoothstep(0.015, 0.03 + aa, g);
    col *= 1.0 - 0.18 * groove;
    bend(normalize(Nw + UP * sign(fract((y - 0.6) / 0.42) - 0.5) * 0.8), groove * 0.5);
  }

  // The cornice under the eaves: a crown moulding facing up and out,
  // a plain fascia, a bed moulding facing down; 32 cm proud, and the
  // roof's eaves another 18 cm beyond it. Their shadow falls on the
  // wall below by the sun's height over the wall.
  float cTop = eave, cBot = eave - 0.45;
  bool hasCornice = !dormer && style < 2.5 && y < eave + 0.01;
  if (hasCornice) {
    float cor = smoothstep(cBot - aa, cBot + aa, y);
    float crown = smoothstep(eave - 0.14 - aa, eave - 0.14 + aa, y);
    float bed = 1.0 - smoothstep(eave - 0.32 - aa, eave - 0.32 + aa, y);
    if (cor > 0.0) {
      col = mix(col, plaster * 1.12 + 0.02, cor);
      bend(normalize(Nw + UP * (crown * 1.2 - bed * 1.4)), cor * max(crown, bed));
      sh = max(sh, fLedge(y, eave, 0.18, sp, aa) * cor);
    }
    sh = max(sh, max(fLedge(y, cBot, 0.32, sp, aa), fLedge(y, eave, 0.5, sp, aa)) * (1.0 - cor));
    // the bed moulding and the wall just under it see little sky
    reliefAO *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.5, cBot - y)) * (1.0 - cor) - 0.3 * bed * cor;
  }

  // storey bands, 18 cm high, 5 cm proud
  if (course && style < 0.5 && !dormer) {
    float fy = mod(y - 0.6, storey);
    float k = floor((y - 0.6) / storey);
    if (k >= 1.0 && y < cBot) {
      float band = smoothstep(-aa, aa, fy) * (1.0 - smoothstep(0.18 - aa, 0.18 + aa, fy));
      col = mix(col, plaster * 1.08, band);
      bend(normalize(Nw + UP), band * step(0.12, fy) * 0.8);
    }
    // the band's shadow on the wall below it (fy wraps to just under the storey line)
    float under = storey - fy;
    if (k >= 0.0 && y + under < cBot) sh = max(sh, step(under, 0.05 * sp.y + aa) * step(1.0, k + 1.0));
  }

  // a dormer's front: one window filling it (aFac: top, bottom, width)
  vec3 Vw = normalize(vWP - cameraPosition);
  // what is seen through glass fades as the glass turns to a mirror
  // toward grazing (Schlick), where the parallax could not hold anyway
  float seeIn = 1.0 - (0.04 + 0.96 * pow(1.0 - max(-dot(Vw, Nw), 0.0), 5.0));
  float vn = max(0.2, -dot(Vw, Nw));
  vec2 rd = vec2(dot(Vw, Tw), Vw.y) / vn;   // the eye ray's drift per metre into the wall
  vec2 par = rd * 0.25;
  if (dormer) {
    vec2 p = vec2(u - L * 0.5, y);
    float lo = storey, hi = eave;
    float inner = fBox(p, vec2(-0.38, lo + 0.28), vec2(0.38, hi - 0.18), aa);
    float outer = fBox(p, vec2(-0.48, lo + 0.18), vec2(0.48, hi - 0.08), aa);
    vec3 frameC = mix(plaster * 1.1, vec3(0.62, 0.6, 0.56), 0.5);
    col = mix(col, frameC, outer);
    fineN *= 1.0 - inner;
    float bars = 1.0 - smoothstep(0.02, 0.02 + aa, abs(p.x));
    col = mix(col, mix(vec3(0.02), frameC, bars), inner);
    rough = mix(rough, 0.06, inner * (1.0 - bars));
    glow += vec3(1.0, 0.6, 0.28) * inner * (1.0 - bars) * uNight * 0.3 * step(fHash(vec2(seed * 9.0, L)), 0.3);
  }

  // window bays
  float bay = church ? 5.5 : grand ? 4.0 : mix(2.9, 3.5, seed);
  float nb = max(1.0, floor(L / bay));
  float bw = L / nb;
  float bi = floor(u / bw);
  float x = (fract(u / bw) - 0.5) * bw;
  // ornate facades: a giant-order pilaster, 8 cm proud, at every bay line
  // from the plinth to the cornice, and the middle three bays of a long
  // wall stepped forward as a risalit, a shade lighter
  if (ornate && !blank && nb >= 3.0 && y > 0.6 && y < cBot) {
    float edge = (0.5 - abs(fract(u / bw) - 0.5)) * bw;          // m to the nearest bay line
    float side = fract(u / bw) < 0.5 ? 1.0 : -1.0;              // +1: the bay line is toward −u
    float inEnds = step(0.5, u) * step(u, L - 0.5);
    float pil = (1.0 - smoothstep(0.3 - aa, 0.3 + aa, edge)) * inEnds;
    bool risalit = nb >= 5.0 && abs(bi - floor(nb / 2.0)) <= 1.0 && mod(nb, 2.0) > 0.5;
    if (risalit) col *= 1.05;
    col = mix(col, plaster * 1.15 + 0.02, pil);
    // the pilaster's side faces, and its shadow on the wall beside it
    float sideFace = pil * (1.0 - smoothstep(0.25, 0.3, edge));
    bend(normalize(Nw - Tw * side * 1.5), sideFace * 0.7);
    float sx = -side * sp.x;    // the shadow reaches this far from the pilaster's face
    sh = max(sh, (1.0 - pil) * step(edge - 0.3, 0.08 * max(sx, 0.0)) * inEnds);
  }

  float fy = y - 0.6;
  float si = floor(fy / storey);
  float ly = fy - si * storey;
  float ww = church ? 1.8 : grand ? 1.35 : mix(1.0, 1.3, vA);
  float wh = church ? storey * 0.75 : storey - mix(1.25, 1.65, vA);
  float wy0 = church ? storey * 0.15 : 0.95;
  // a window row only where the whole window fits below the cornice
  bool fits = !blank && !dormer && L > 2.0 && fy > 0.0 && 0.6 + si * storey + wy0 + wh < eave - 0.45;
  bool fitsAbove = !blank && !dormer && L > 2.0 && 0.6 + (si + 1.0) * storey + wy0 + wh < eave - 0.45;
  // the door: ground storey, the middle bay of a long enough wall
  bool door = !blank && si < 0.5 && nb >= 3.0 && abs(bi - floor(nb / 2.0)) < 0.5 && L > 7.0;
  // a shop: the ground storey's bays are display windows under a fascia
  bool shopBay = shop && !blank && si < 0.5 && L > 4.0 && !door;
  vec3 frameC = mix(plaster * 1.1, vec3(0.62, 0.6, 0.56), 0.5);
  // sashes: white, brown or green paint
  float sk = fHash(vec2(seed * 13.0, 2.0));
  vec3 sash = sk < 0.5 ? vec3(0.62, 0.6, 0.55) : sk < 0.8 ? vec3(0.12, 0.07, 0.04) : vec3(0.05, 0.09, 0.06);
  float wid = bi * 7.0 + si * 13.0 + seed * 101.0;   // this window's id
  // light into the rooms: the sky through the window, and the sun if it shines in
  vec3 Ein = uSkyE * 0.5 + uSunE * max(lN, 0.0) * 0.4;
  float dist = length(vWP - cameraPosition);
  // rain run off the sill above, in streaks down the wall
  if (!blank && !dormer && !shopBay && style < 1.5 && fy > 0.0) {
    float sillHere = wy0 - 0.2;
    bool from = ly < sillHere ? fits && !door : fitsAbove;
    float dd = ly < sillHere ? sillHere - ly : storey + sillHere - ly;
    if (from) {
      float wx = smoothstep(ww * 0.5 + 0.2, ww * 0.5 - 0.1, abs(x));
      float run = exp(-dd / 1.1) * smoothstep(0.3, 0.75, fNoise(vec2(x * 11.0 + wid, dd * 0.6)));
      col *= 1.0 - 0.22 * run * wx;
    }
  }
  // the shop's board runs the width of the front, over the door too
  bool shopWall = shop && !blank && L > 4.0 && si < 0.5;
  float sw0 = fHash(vec2(seed * 31.0, floor(L * 7.0)));   // this front's sign
  float sw1 = fHash(vec2(seed * 17.0, floor(L * 3.0) + 2.0));
  // boards: dark green, black, oxblood, dark blue, brown, or cream
  vec3 board = sw1 < 0.25 ? vec3(0.025, 0.05, 0.03) : sw1 < 0.45 ? vec3(0.012) : sw1 < 0.6 ? vec3(0.08, 0.018, 0.014)
             : sw1 < 0.72 ? vec3(0.018, 0.026, 0.05) : sw1 < 0.88 ? vec3(0.06, 0.035, 0.018) : vec3(0.42, 0.38, 0.3);
  vec3 wood = board;
  if (shopWall && fy > 0.0) {
    float fascia = smoothstep(2.75 - aa, 2.75 + aa, fy) * (1.0 - smoothstep(3.2 - aa, 3.2 + aa, fy));
    // the lettering: gilt, white, or black on the cream board, centred
    // (u runs right to left as you face the wall)
    float ht = 0.44, ws = uSignA[int(floor(sw0 * uSignN))] * ht;
    if (ws > L - 0.8) { ht *= (L - 0.8) / ws; ws = L - 0.8; }
    vec2 st = vec2((L - u - (L - ws) * 0.5) / ws, (fy - 2.975) / ht + 0.5);
    float row = floor(sw0 * uSignN);
    float letters = 0.0;
    if (uSignN > 0.0 && st.x > 0.0 && st.x < 1.0 && st.y > 0.0 && st.y < 1.0)
      letters = texture2D(tSigns, vec2(st.x * ws / ht * ${(SIGN_H / SIGN_W).toFixed(5)}, 1.0 - (row + 1.0 - st.y) / ${SIGN_ROWS.toFixed(1)})).r * fascia;
    vec3 ink = sw1 > 0.88 ? vec3(0.02) : fract(sw1 * 7.0) < 0.6 ? vec3(0.55, 0.4, 0.12) : vec3(0.62, 0.6, 0.55);
    col = mix(col, board, fascia);
    col = mix(col, ink, letters);
    rough = mix(rough, mix(0.45, 0.3, letters), fascia);
    sh = max(sh, fLedge(fy, 2.75, 0.1, sp, aa) * (1.0 - fascia));
  }
  if (shopBay && fy > 0.0) {
    vec2 p = vec2(x, fy);
    float sw = min(bw - 0.5, 2.6);
    vec2 a = vec2(-sw * 0.5, 0.35), b = vec2(sw * 0.5, 2.55);
    float glassA = fBox(p, a, b, aa);
    float frameA = fBox(p, a - 0.1, b + 0.1, aa);
    col = mix(col, wood, frameA);
    rough = mix(rough, 0.45, frameA);
    fineN *= 1.0 - frameA;
    // the display behind the glass: a cloth-covered platform 50 cm back
    // with the goods on it in a row of their own widths — loaves and
    // hats rounded, boxes and bolts square, bottles narrow — a shelf of
    // smaller things above, and in some shops things hung from a rail;
    // the shop beyond, dim
    vec2 G = p + rd * 0.15;
    float bars = step(abs(G.y - 2.1), 0.03);
    vec3 inside = fRoom(G, rd, vec2(-sw * 0.5, 0.0), vec2(sw * 0.5, 3.0), wid) * 0.7;
    vec2 D = p + rd * 0.5;
    // what the shop shows: its goods' colours, by the sign it carries
    float kind = fract(sw0 * 7.3);
    vec3 gA = kind < 0.25 ? vec3(0.32, 0.18, 0.08) : kind < 0.5 ? vec3(0.42, 0.4, 0.36) : kind < 0.75 ? vec3(0.16, 0.08, 0.06) : vec3(0.1, 0.14, 0.2);
    vec3 gB = kind < 0.25 ? vec3(0.5, 0.33, 0.16) : kind < 0.5 ? vec3(0.62, 0.6, 0.55) : kind < 0.75 ? vec3(0.34, 0.25, 0.14) : vec3(0.3, 0.12, 0.1);
    float item = 0.0; vec3 ic = gA;
    for (int row = 0; row < 2; row++) {
      float y0 = row == 0 ? 0.75 : 1.58, sc = row == 0 ? 1.0 : 0.6;
      float cx = D.x / (0.24 * sc) + float(row) * 0.37, ci = floor(cx), cf = fract(cx);
      float k1 = fHash(vec2(ci, wid + float(row) * 3.0)), k2 = fHash(vec2(ci + 7.0, wid)), k3 = fHash(vec2(ci, wid + 11.0));
      float hw = (0.2 + 0.28 * k1), dx = (cf - 0.5) / hw;
      float ih = (0.12 + 0.38 * k2) * sc;
      float shape = fract(k3 + kind * 3.0);
      float top = shape < 0.4 ? ih * sqrt(max(0.0, 1.0 - dx * dx)) : shape < 0.8 ? ih : (abs(dx) < 0.35 ? ih + 0.1 * sc : ih * 0.75);
      float w = shape < 0.8 ? 1.0 : 0.6;
      float it = step(abs(dx), w) * step(y0, D.y) * step(D.y, y0 + top) * step(0.25, k3 + kind);
      if (it > 0.5) { item = 1.0; ic = mix(gA, gB, fHash(vec2(ci, wid + 5.0))) * (0.75 + 0.35 * (D.y - y0) / max(top, 0.01)); }
    }
    // hung from a rail: sausages, hats, garments
    if (kind < 0.5 || kind > 0.85) {
      float cx = D.x / 0.18, ci = floor(cx), dx = abs(fract(cx) - 0.5) / 0.3;
      float hang = 0.25 + 0.35 * fHash(vec2(ci, wid + 13.0));
      if (dx < 1.0 && D.y < 2.3 && D.y > 2.3 - hang * sqrt(max(0.0, 1.0 - dx * dx * 0.5)) && fHash(vec2(ci, wid + 17.0)) > 0.35) { item = 1.0; ic = gA * 0.8; }
    }
    inside = mix(inside, ic, item);
    // the platform's cloth, the shelf, and a valance across the top of the glass
    inside = mix(inside, kind < 0.5 ? vec3(0.3, 0.29, 0.26) : vec3(0.12, 0.05, 0.045), (1.0 - item) * step(D.y, 0.75) * step(0.4, D.y));
    inside = mix(inside, vec3(0.05, 0.035, 0.025), step(abs(D.y - 1.56), 0.025) + step(D.y, 0.4));
    inside = mix(inside, vec3(0.1, 0.04, 0.03) * (0.8 + 0.2 * sin(G.x * 40.0)), step(2.36, G.y) * step(fract(kind * 5.0), 0.6));
    col = mix(col, mix(vec3(0.01), wood, bars), glassA);
    rough = mix(rough, 0.05, glassA * (1.0 - bars));
    mirrorStreet(glassA * (1.0 - bars), Vw, Nw, bi + seed * 31.0);
    // (indoors the daylight is a fraction of the street's, deeper in the less)
    glow += glassA * (1.0 - bars) * inside * Ein / 3.14159 * 0.4 * (0.4 + 0.6 * fBox(G + 0.15 * sp, a, b, aa));
    // by evening most shops have closed: a few still lit, dimmer than rooms
    glow += glassA * (1.0 - bars) * vec3(1.0, 0.6, 0.28) * inside * 1.2 * uNight * step(fHash(vec2(bi + 3.0, seed * 17.0)), 0.3);
  } else if (fits) {
    float frame = 0.12;
    vec2 p = vec2(x, ly);
    vec2 a = door ? vec2(-0.75, -0.6) : vec2(-ww * 0.5, wy0);
    vec2 b = door ? vec2(0.75, 2.75) : vec2(ww * 0.5, wy0 + wh);
    float outer = fBox(p, a - frame, b + frame, aa);
    float opening = fBox(p, a, b, aa);
    // the glass (or the door) 25 cm behind the facade, where the eye ray meets it
    vec2 G = p + par;
    float inner = opening * fBox(G, a, b, aa);
    // arched heads on churches
    if (church) {
      float r = ww * 0.5;
      vec2 c = vec2(0.0, b.y);
      float arch = 1.0 - smoothstep(r - aa, r + aa, length(p - c));
      inner = max(inner * step(p.y, b.y), arch * step(b.y, p.y));
      opening = max(opening, arch * step(b.y, p.y));
      outer = max(outer * step(p.y, b.y + frame), (1.0 - smoothstep(r + frame - aa, r + frame + aa, length(p - c))) * step(b.y, p.y));
    }
    float bow = 0.0;
    if (!church && !door && head > 1.5) {
      // a segmental head: the opening's top bowed up by 18 cm
      bow = 0.18 * (1.0 - (p.x * p.x) / (ww * ww * 0.25));
      float inA = step(p.y, b.y + bow) * step(a.y, p.y) * step(abs(p.x), ww * 0.5);
      float outA = step(p.y, b.y + bow + frame) * step(a.y - frame, p.y) * step(abs(p.x), ww * 0.5 + frame);
      inner = max(inner, inA * fBox(G, a, b + vec2(0.0, bow), aa));
      opening = max(opening, inA);
      outer = max(outer, outA);
    }
    float reveal = max(opening - inner, 0.0);
    col = mix(col, frameC, outer);
    fineN *= 1.0 - inner;
    // the reveal we see: its normal, by which side the eye ray meets
    if (reveal > 0.0) {
      col = mix(col, plaster * 0.95, reveal);
      vec3 rn = G.x < a.x ? Tw : G.x > b.x ? -Tw : G.y > b.y + bow ? -UP : UP;
      bend(rn, reveal);
      reliefAO *= 1.0 - 0.3 * reveal;
    }
    if (!church && !door && head > 0.5 && head < 1.5) {
      // a small cornice over the window, 12 cm proud, with its shadow beneath
      vec2 ca = vec2(a.x - 0.25, b.y + frame + 0.04), cb = vec2(b.x + 0.25, b.y + frame + 0.16);
      float cap = fBox(p, ca, cb, aa);
      col = mix(col, frameC * 1.05, cap);
      bend(normalize(Nw + UP * 1.2), cap * step(cb.y - 0.05, p.y));
      float capSh = fLedge(p.y, ca.y, 0.12, sp, aa) * step(ca.x - 0.12 * sp.x, p.x) * step(p.x, cb.x - 0.12 * sp.x);
      sh = max(sh, capSh * (1.0 - cap));
      reliefAO *= 1.0 - 0.25 * fBox(p, vec2(ca.x, ca.y - 0.15), vec2(cb.x, ca.y), aa);
    }
    // the sill below, 7 cm proud, with its shadow
    if (!door) {
      vec2 sa = vec2(a.x - 0.18, a.y - 0.2), sb = vec2(b.x + 0.18, a.y - 0.08);
      float sill = fBox(p, sa, sb, aa);
      col = mix(col, plaster * 0.82 + 0.02, sill);
      bend(normalize(Nw + UP * (p.y > sb.y - 0.04 ? 1.5 : -0.3)), sill * 0.8);
      sh = max(sh, fLedge(p.y, sa.y, 0.07, sp, aa) * step(sa.x - 0.07 * sp.x, p.x) * step(p.x, sb.x - 0.07 * sp.x) * (1.0 - sill));
    }
    // whether the sun reaches the glass through the opening
    float lit = fBox(G + 0.25 * sp, a, b + vec2(0.0, bow), aa);
    sh = max(sh, inner * (1.0 - lit));
    if (door) {
      // a panelled wooden door
      vec3 wood = mix(vec3(0.12, 0.07, 0.04), vec3(0.2, 0.15, 0.1), seed);
      float panel = fBox(vec2(abs(G.x) - 0.37, mod(G.y, 0.9)), vec2(-0.25, 0.12), vec2(0.25, 0.78), aa);
      col = mix(col, wood * (0.8 + 0.25 * panel), inner);
      rough = mix(rough, 0.6, inner);
      reliefAO *= 1.0 - 0.3 * inner;
    } else {
      // the sash: its frame, a cross and a bar in the lower half
      float sf = 1.0 - fBox(G, a + 0.06, b + vec2(0.0, bow) - 0.06, aa);
      float bars = max(max(1.0 - smoothstep(0.025, 0.025 + aa, abs(G.x)),
                           1.0 - smoothstep(0.025, 0.025 + aa, abs(G.y - a.y - wh * 0.64))),
                       1.0 - smoothstep(0.02, 0.02 + aa, abs(G.y - a.y - wh * 0.32)));
      float wood = max(sf, bars);
      float glass = inner * (1.0 - wood);
      col = mix(col, sash, inner * wood);
      col = mix(col, vec3(0.008), glass);
      // old panes are never quite flat: each tilts its reflection a little
      float pane = floor(G.x / (ww * 0.5)) * 5.0 + floor((G.y - a.y) / (wh * 0.32)) + wid * 13.0;
      fineN += (vec3(fHash(vec2(pane, 1.0)), fHash(vec2(pane, 2.0)), fHash(vec2(pane, 3.0))) - 0.5) * 0.05 * glass;
      mirrorStreet(glass, Vw, Nw, pane);
      rough = mix(rough, mix(0.05, 0.5, wood), inner);
      // behind the glass: lace, drapes or a blind in most windows, the room
      vec2 C = p + rd * 0.32;
      float ck = fHash(vec2(wid, 5.3));
      float lace = 0.0, drape = 0.0;
      vec2 cc = (C - a) / (b - a);
      if (ck < 0.75) {
        float gather = 0.75 + 0.25 * sin(C.x * 38.0 + 3.0 * fNoise(C * 4.0));
        float mesh = mix(0.55 + 0.45 * fNoise(C * 70.0) * (0.6 + 0.4 * sin(C.x * 160.0) * sin(C.y * 160.0)), 0.75, smoothstep(4.0, 15.0, dist));
        lace = (ck < 0.45 ? 0.8 : 0.8 * step(cc.y, 0.62)) * mesh * gather;
      }
      if (ck > 0.3 && ck < 0.85) drape = 1.0 - smoothstep(0.16, 0.2, min(cc.x, 1.0 - cc.x));
      float blind = ck > 0.9 ? step(1.0 - 0.2 - 0.6 * fHash(vec2(wid, 9.1)), cc.y) : 0.0;
      float dk = fHash(vec2(wid, 2.2));
      vec3 dc = dk < 0.4 ? vec3(0.13, 0.035, 0.03) : dk < 0.7 ? vec3(0.045, 0.075, 0.05) : vec3(0.2, 0.16, 0.1);
      dc *= 0.75 + 0.25 * sin(C.x * 30.0);   // folds
      vec3 room = fRoom(G, rd, vec2(-bw * 0.5 + 0.15, 0.0), vec2(bw * 0.5 - 0.15, storey - 0.3), wid);
      vec3 behind = mix(room, vec3(0.62, 0.6, 0.55), lace);
      behind = mix(behind, dc, drape);
      behind = mix(behind, vec3(0.42, 0.36, 0.26), blind);
      float sunIn = 0.4 + 0.6 * lit;
      glow += glass * behind * Ein * sunIn / 3.14159;
      // about a third of the rooms have a lamp lit at night
      float on = step(fHash(vec2(bi * 1.7 + seed * 13.0, si * 3.1 + L)), 0.33);
      glow += glass * mix(room * 1.6, behind, 0.7) * vec3(1.0, 0.62, 0.3) * 1.1 * on * uNight;
      reliefAO *= 1.0 - 0.5 * glass;
      // Flower boxes on the sills of some houses' upper windows:
      // geraniums, red and pink, in boxes of green-painted wood or
      // terracotta, 18 cm high and standing 20 cm out, so they hide the
      // foot of the window and shade the wall below.
      if (!ornate && !grand && si >= 1.0 && fHash(vec2(seed * 91.0, 2.5)) < 0.22 && fHash(vec2(wid, 6.1)) < 0.75) {
        vec2 ba = vec2(a.x - 0.04, a.y - 0.08), bb = vec2(b.x + 0.04, a.y + 0.1);
        float box = fBox(p, ba, bb, aa);
        // the leaves and flowers over it, a ragged mound
        float mound = bb.y + 0.05 + 0.13 * fNoise(vec2(p.x * 9.0 + wid, 1.0)) * smoothstep(ba.x, ba.x + 0.15, p.x) * (1.0 - smoothstep(bb.x - 0.15, bb.x, p.x));
        float leaves = step(ba.x + 0.02, p.x) * step(p.x, bb.x - 0.02) * step(bb.y - 0.01, p.y) * step(p.y, mound);
        float bloom = leaves * step(0.62, fNoise(p * 38.0 + wid));
        vec3 boxC = fHash(vec2(seed * 37.0, 1.1)) < 0.5 ? vec3(0.05, 0.09, 0.05) : vec3(0.28, 0.11, 0.06);
        vec3 flower = fHash(vec2(seed * 41.0, 3.3)) < 0.6 ? vec3(0.5, 0.04, 0.03) : vec3(0.55, 0.16, 0.22);
        vec3 leafC = vec3(0.035, 0.07, 0.02) * (0.7 + 0.6 * fNoise(p * 60.0));
        float any = max(box, leaves);
        col = mix(col, boxC * (0.85 + 0.15 * fNoise(p * 20.0)), box);
        col = mix(col, mix(leafC, flower, bloom), leaves * (1.0 - box));
        rough = mix(rough, 0.8, any);
        glow *= 1.0 - any;
        fineN *= 1.0 - any;
        bend(normalize(Nw + UP * (p.y > bb.y - 0.03 ? 1.2 : 0.0)), box * 0.8);
        reliefAO *= 1.0 - 0.25 * leaves;
        sh = max(sh, fLedge(p.y, ba.y, 0.2, sp, aa) * step(ba.x - 0.2 * sp.x, p.x) * step(p.x, bb.x - 0.2 * sp.x) * (1.0 - any));
      }
    }
  }
  glow *= seeIn;
  if (uSrcView > 0.5) {
    // green: standing today; blue: lost, OHM; orange: rebuilt from the 1903 map; violet: modelled
    vec3 sc = src < 0.5 ? vec3(0.15, 0.5, 0.15) : src < 1.5 ? vec3(0.1, 0.3, 0.85) : src < 2.5 ? vec3(0.95, 0.45, 0.05) : vec3(0.65, 0.2, 0.8);
    col = mix(col, sc, 0.85);
  }
  // shadows of the relief only where the sun is on the wall's face at all
  reliefSun = 1.0 - sh * step(0.0, lN);
  diffuseColor.rgb = col;
`;

/* Roofs, in roof coordinates (u along the eaves, v up the slope, in
   metres). By the roof's colour: clay (beaver-tail tiles, the common
   roof: courses of about 17 cm, each tile's rounded end lying on the
   course below), slate (rectangles, a little sheen), or copper
   (standing seams, patina run down in streaks). The relief bends the
   normal: each course lies a little flatter than the roof, and its
   lower edge is a small step facing down the slope. Old roofs carry
   moss and lichen where they stay damp, and soot. */
function roofMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSrc;\nvarying vec2 vRoof;\nvarying float vSrc;\nvarying vec3 vRP;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoof = uv; vSrc = aSrc; vRP = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSrcView;
        varying vec2 vRoof;
        varying float vSrc;
        varying vec3 vRP;
        vec3 roofN = vec3(0.0, 1.0, 0.0);
        float roofBend = 0.0, roofRough = 0.85, roofAO = 1.0;
        float rHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
        float rNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(rHash(i), rHash(i + vec2(1, 0)), f.x), mix(rHash(i + vec2(0, 1)), rHash(i + vec2(1, 1)), f.x), f.y); }
        float rFbm(vec2 p) { return 0.5 * rNoise(p) + 0.25 * rNoise(p * 2.1 + 5.0) + 0.125 * rNoise(p * 4.3 + 1.0) + 0.0625 * rNoise(p * 8.7 + 3.0); }`)
      .replace('#include <map_fragment>', /* glsl */ `
        vec3 base = diffuseColor.rgb * vColor;
        // an old roof is never true: the courses wander a little and the
        // battens sag between the rafters
        vec2 r = vRoof + vec2(0.0, 0.035 * (rNoise(vRoof * vec2(0.45, 0.2)) - 0.5) + 0.02 * (rNoise(vRoof * vec2(2.3, 0.5)) - 0.5));
        // the roof's frame in the world: T along the eaves, B up the slope
        vec3 N0 = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz);
        vec3 dp1 = dFdx(vRP), dp2 = dFdy(vRP);
        vec2 du1 = dFdx(r), du2 = dFdy(r);
        vec3 p2 = cross(dp2, N0), p1 = cross(N0, dp1);
        vec3 T = p2 * du1.x + p1 * du2.x, B = p2 * du1.y + p1 * du2.y;
        float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
        T *= im; B *= im;
        float aa = max(fwidth(r.x), fwidth(r.y)) + 0.001;
        float far = smoothstep(0.03, 0.12, aa);      // the pattern fades to its mean where it would alias
        float sat = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
        bool copper = base.g > base.r;
        bool clay = !copper && base.r > base.g * 1.4 && sat > 0.05;
        vec3 col = base;
        // weathering, at the roof's scale: damp lower courses and the north
        // side grow moss, soot settles, rain draws streaks down the slope
        float north = smoothstep(-0.2, 0.6, -N0.z);
        float damp = smoothstep(0.35, 0.75, rFbm(vRP.xz * 0.35 + 7.0)) * (0.5 + 0.5 * north);
        float streak = rNoise(vec2(r.x * 1.7, r.y * 0.08)) * rNoise(vec2(r.x * 0.4 + 9.0, r.y * 0.3));
        if (clay) {
          float rowH = 0.17, tw = 0.18;
          float row = floor(r.y / rowH);
          float tx = r.x / tw + 0.5 * mod(row, 2.0);
          float t = floor(tx), fx = fract(tx) - 0.5;
          // the tile's rounded end: its lower edge dips in the middle
          float fy = r.y / rowH - row - 0.22 * (0.25 - fx * fx);
          if (fy < 0.0) { row -= 1.0; tx = r.x / tw + 0.5 * mod(row, 2.0); t = floor(tx); fx = fract(tx) - 0.5; fy += 1.0; }
          float k = rHash(vec2(t, row));
          // fired clay darkened by a century of weather: browner, and every
          // tile its own shade, some replaced and brighter, some sooty
          vec3 aged = mix(base, vec3(dot(base, vec3(0.4, 0.45, 0.15))), 0.3) * vec3(0.55, 0.6, 0.68);
          vec3 tile = aged * (0.7 + 0.5 * k);
          float odd = rHash(vec2(t, row) + 3.0);
          tile = odd > 0.92 ? tile * vec3(1.25, 1.1, 1.0) : odd < 0.1 ? tile * vec3(0.6, 0.6, 0.62) : tile;
          tile *= 0.85 + 0.3 * rFbm(vec2(t * 0.31, row * 0.47) + 11.0);
          float gap = 1.0 - smoothstep(0.43, 0.5, abs(fx));
          float butt = 1.0 - smoothstep(0.0, 0.1, fy);
          tile *= mix(0.55, 1.0, gap) * mix(0.7, 1.0, smoothstep(0.0, 0.25, fy));
          col = mix(tile, aged * 0.92, far);
          // relief: the course a little flatter than the roof, its butt a step down
          roofN = normalize(N0 + B * 0.12 * (1.0 - butt) - B * 1.6 * butt + T * fx * 0.25);
          roofBend = 1.0 - far;
          roofAO = mix(mix(0.75, 1.0, smoothstep(0.0, 0.3, fy)) * mix(0.8, 1.0, gap), 0.92, far);
          // moss in the joints and on damp tiles; lichen in specks
          float moss = damp * smoothstep(0.3, 0.7, rFbm(r * 3.0 + 2.0)) * (0.6 + 0.4 * (1.0 - smoothstep(0.0, 0.5, fy)));
          col = mix(col, vec3(0.09, 0.1, 0.05) * (0.8 + 0.4 * rNoise(r * 20.0)), moss * 0.7);
          float lichen = step(0.82, rNoise(r * 14.0 + 31.0)) * damp;
          col = mix(col, vec3(0.32, 0.27, 0.14), lichen * 0.5 * (1.0 - far));
          roofRough = 0.88;
        } else if (copper) {
          float seam = 1.0 - smoothstep(0.0, 0.02 + aa, abs(fract(r.x / 0.6) - 0.5) * 0.6 - 0.27);
          col = base * (0.85 + 0.25 * rHash(vec2(floor(r.x / 0.6), 3.0))) * (1.0 - 0.15 * seam);
          col = mix(col, col * vec3(0.7, 0.8, 0.75), streak * 0.6);
          roofN = normalize(N0 + T * sign(fract(r.x / 0.6) - 0.5) * seam * 0.6);
          roofBend = seam * (1.0 - far);
          roofRough = 0.55;
        } else {
          // slate: rectangles in courses, each a slightly different grey
          float rowH = 0.2, tw = 0.3;
          float row = floor(r.y / rowH);
          float tx = r.x / tw + 0.5 * mod(row, 2.0);
          float fy = fract(r.y / rowH), fx = fract(tx) - 0.5;
          float k = rHash(vec2(floor(tx), row));
          float butt = 1.0 - smoothstep(0.0, 0.08, fy);
          vec3 slate = base * (0.82 + 0.3 * k) * mix(0.6, 1.0, 1.0 - butt * 0.6) * mix(0.7, 1.0, smoothstep(0.5, 0.46, abs(fx)));
          col = mix(slate, base * 0.95, far);
          roofN = normalize(N0 + B * 0.08 - B * 1.4 * butt);
          roofBend = 1.0 - far;
          roofRough = mix(0.5 + 0.2 * k, 0.6, far);
          roofAO = mix(mix(0.8, 1.0, smoothstep(0.0, 0.3, fy)), 0.94, far);
        }
        // the roof's surface undulates over metres: sagging between the
        // rafters, settled over the years, so it catches the light unevenly
        vec2 wv = vec2(rNoise(vRoof * vec2(0.35, 0.28) + 3.0), rNoise(vRoof * vec2(0.3, 0.22) + 8.0)) - 0.5;
        roofN = normalize(mix(N0, roofN, roofBend) + (T * wv.x + B * wv.y) * 0.09);
        roofBend = 1.0;
        // soot and rain streaks, and dirt toward the eaves
        col *= 1.0 - 0.22 * streak * smoothstep(0.2, 0.6, rFbm(vRP.xz * 0.2));
        col *= mix(0.8, 1.0, smoothstep(0.0, 1.5, r.y));
        // aged: browner and greyer than new
        col = mix(col, vec3(dot(col, vec3(0.35, 0.5, 0.15))) * vec3(1.05, 0.95, 0.85), 0.18);
        // seen from below (a gateway's ceiling, under the eaves): boards, not tiles
        if (!gl_FrontFacing) { col = vec3(0.1, 0.085, 0.065) * (0.8 + 0.3 * rNoise(vec2(r.x * 6.0, 0.5))); roofN = N0; roofAO = 0.7; }
        diffuseColor.rgb = col;
        if (uSrcView > 0.5) {
          vec3 sc = vSrc < 0.5 ? vec3(0.15, 0.5, 0.15) : vSrc < 1.5 ? vec3(0.1, 0.3, 0.85) : vSrc < 2.5 ? vec3(0.95, 0.45, 0.05) : vec3(0.65, 0.2, 0.8);
          diffuseColor.rgb = mix(diffuseColor.rgb, sc, 0.85);
        }
      `)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = roofRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, (viewMatrix * vec4(roofN, 0.0)).xyz * (gl_FrontFacing ? 1.0 : -1.0), roofBend));')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= roofAO;');
    sh.uniforms.uSrcView = sourceView;
  };
  m.customProgramCacheKey = () => 'roof';
  return m;
}

export const facadeMat = facadeMaterial();
export const roofMat = roofMaterial();

function wallGeometry(w: WallBuf, sky: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('aSky', new THREE.Float32BufferAttribute(sky, 1));
  g.setAttribute('position', new THREE.Float32BufferAttribute(w.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(w.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(w.uv, 2));
  g.setAttribute('aFac', new THREE.Float32BufferAttribute(w.fac, 4));
  g.setAttribute('color', new THREE.Float32BufferAttribute(w.col, 3));
  g.computeBoundingSphere();
  return g;
}
function roofGeometry(r: RoofBuf) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(r.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(r.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(r.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(r.col, 3));
  g.setAttribute('aSrc', new THREE.Float32BufferAttribute(r.src, 1));
  g.computeBoundingSphere();
  return g;
}

/* Party walls: an edge is one where, a little outside it, another
   building stands at least as high as this one's eaves. A grid of
   footprints' boxes keeps the test local. */
function partyWalls(list: Building[]) {
  const G = 25, grid = new Map<string, number[]>();
  const boxes = list.map((b) => bbox(b.outer));
  boxes.forEach(([x0, z0, x1, z1], i) => {
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) {
      const k = gx + ',' + gz;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    }
  });
  const standsAt = (self: number, x: number, z: number, y: number) => {
    for (const i of grid.get(Math.floor(x / G) + ',' + Math.floor(z / G)) ?? []) {
      if (i === self) continue;
      const o = list[i]!, bb = boxes[i]!;
      if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3] || o.eave + o.roofH < y - 0.3 || (o.base ?? 0) > 2) continue;
      if (inside(o.outer, x, z) && !(o.holes ?? []).some((h) => inside(h, x, z))) return true;
    }
    return false;
  };
  return (self: number) => (ax: number, az: number, bx: number, bz: number) => {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    const nx = dz / L, nz = -dx / L, y = list[self]!.eave;
    let hits = 0;
    for (const t of [0.2, 0.5, 0.8]) if (standsAt(self, ax + dx * t + nx * 0.6, az + dz * t + nz * 0.6, y)) hits++;
    return hits < 2;
  };
}

/* Awnings: canvas in stripes of cream and the vertex colour, 32 cm
   wide, dirtier toward the front edge; the valance's lower edge cut
   in scallops; lit through from behind (canvas lets a fifth of the
   sun through), so from under it glows. */
const SLOPE = Math.hypot(1.4, 0.75), VALANCE = 0.24;
export const clothMat = (() => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vCl;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCl = uv;');
    const L = THREE.ShaderChunk.lights_fragment_begin;
    const i = L.indexOf('RE_Direct(', L.indexOf('getDirectionalLightInfo( directionalLight, directLight );'));
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vCl;
      float cH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float cN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(cH(i), cH(i + vec2(1, 0)), f.x), mix(cH(i + vec2(0, 1)), cH(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float scallop = 0.07 * (1.0 - abs(sin(3.14159 * vCl.x / 0.32)));
        if (vCl.y > ${(SLOPE + VALANCE).toFixed(3)} - scallop) discard;
        float st = step(0.5, fract(vCl.x / 0.32));
        vec3 cc = mix(vec3(0.6, 0.55, 0.45), vColor, st);
        cc *= (0.88 + 0.2 * cN(vCl * vec2(3.0, 9.0))) * mix(1.0, 0.75, smoothstep(0.6, ${(SLOPE + VALANCE).toFixed(3)}, vCl.y) * cN(vCl * vec2(1.5, 4.0)));
        diffuseColor.rgb = cc;`)
      .replace('#include <color_fragment>', '')
      .replace('#include <lights_fragment_begin>', L.slice(0, i) + `
        reflectedLight.directDiffuse += directLight.color * diffuseColor.rgb * 0.2 * max(0.0, -dot(geometryNormal, directLight.direction));
        ` + L.slice(i));
  };
  m.customProgramCacheKey = () => 'cloth';
  return m;
})();

// Gutters and downpipes: zinc, gone dull grey.
export const metalMat = new THREE.MeshStandardMaterial({ color: 0x6f7375, roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide });

export function buildBuildings(list: Building[], hf: HeightField, signList: string[] = []) {
  drawSigns(signList);
  const group = new THREE.Group();
  group.name = 'buildings';
  const tiles = new Map<string, { w: WallBuf; r: RoofBuf; m: MetalBuf; c: ClothBuf }>();
  const party = partyWalls(list);
  list.forEach((b, bi) => {
    const [cx, cz] = centroid(b.outer);
    const key = Math.floor(cx / TILE) + ',' + Math.floor(cz / TILE);
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { w: wallBuf(), r: roofBuf(), m: metalBuf(), c: clothBuf() }));
    const w0 = t.w.pos.length, r0 = t.r.pos.length, m0 = t.m.pos.length, c0 = t.c.pos.length;
    try { buildMassing(b, t.w, t.r, true, { exposed: party(bi), metal: t.m, cloth: t.c }); } catch (e) { console.warn('building', b.id, e); }
    // on a slope a building stands at its lowest corner, its uphill side in the ground
    let gy = Infinity;
    for (let i = 0; i < b.outer.length; i += 2) gy = Math.min(gy, heightAt(b.outer[i]!, b.outer[i + 1]!));
    if (gy > 0.01) {
      for (let i = w0 + 1; i < t.w.pos.length; i += 3) t.w.pos[i]! += gy;
      for (let i = r0 + 1; i < t.r.pos.length; i += 3) t.r.pos[i]! += gy;
      for (let i = m0 + 1; i < t.m.pos.length; i += 3) t.m.pos[i]! += gy;
      for (let i = c0 + 1; i < t.c.pos.length; i += 3) t.c.pos[i]! += gy;
    }
  });
  for (const t of tiles.values()) {
    if (t.w.pos.length) {
      // each wall vertex's open sky, once per corner (a quad's six
      // vertices are four corners)
      const sky: number[] = [], seen = new Map<string, number>();
      const P = t.w.pos, N = t.w.nrm;
      for (let i = 0; i < P.length; i += 3) {
        const nx = N[i]!, ny = N[i + 1]!, nz = N[i + 2]!;
        const key = P[i]!.toFixed(2) + ',' + P[i + 1]!.toFixed(2) + ',' + P[i + 2]!.toFixed(2) + ',' + nx.toFixed(2) + nz.toFixed(2);
        let v = seen.get(key);
        if (v === undefined) {
          const l = Math.hypot(nx, nz);
          // soffits face down: they see the street, not the sky
          v = ny < -0.5 ? 0.3 : l > 0.1 ? wallSky(hf, P[i]!, P[i + 2]!, nx / l, nz / l, P[i + 1]!) : 1;
          seen.set(key, v);
        }
        sky.push(v);
      }
      const m = new THREE.Mesh(wallGeometry(t.w, sky), facadeMat);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    if (t.r.pos.length) {
      const m = new THREE.Mesh(roofGeometry(t.r), roofMat);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    if (t.m.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(t.m.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(t.m.nrm, 3));
      g.computeBoundingSphere();
      // thin: too fine for the shadow map, and hiding nothing worth a depth pre-pass
      const m = new THREE.Mesh(g, metalMat);
      m.receiveShadow = true;
      m.userData.noPrepass = true;
      group.add(m);
    }
    if (t.c.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(t.c.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(t.c.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(t.c.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(t.c.col, 3));
      g.computeBoundingSphere();
      // (it cuts its scallops, so it stays off the depth pre-pass)
      const m = new THREE.Mesh(g, clothMat);
      m.castShadow = m.receiveShadow = true;
      m.userData.noPrepass = true;
      group.add(m);
    }
  }
  return group;
}
