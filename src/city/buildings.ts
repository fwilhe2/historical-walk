import * as THREE from 'three';
import { centroid } from '../geom/poly';
import { buildMassing, roofBuf, wallBuf, type RoofBuf, type WallBuf } from './massing';
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
const FACADE_PARS = /* glsl */ `
uniform float uNight;
varying vec4 vFac;
varying vec2 vWall;
varying vec3 vWP;
varying vec3 vWN;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// 1 inside the box [a, b] with a soft edge of w
float fBox(vec2 p, vec2 a, vec2 b, float w) {
  vec2 s = smoothstep(a - w, a + w, p) * (1.0 - smoothstep(b - w, b + w, p));
  return s.x * s.y;
}
`;

function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFac;\nvarying vec4 vFac;\nvarying vec2 vWall;\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = aFac; vWall = uv; vWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_PARS)
      .replace('#include <map_fragment>', /* glsl */ `
        float u = vWall.x, y = vWall.y;
        float eave = vFac.x, storey = vFac.y, L = vFac.z;
        float flags = floor(vFac.w), seed = fract(vFac.w);
        bool blank = mod(flags, 2.0) >= 1.0;
        bool church = mod(floor(flags / 2.0), 2.0) >= 1.0;
        bool grand = mod(floor(flags / 4.0), 2.0) >= 1.0;
        float style = mod(floor(flags / 8.0), 8.0);
        bool ornate = flags >= 64.0;
        vec3 plaster = diffuseColor.rgb;
        // weathering: faint vertical streaks and a darker foot
        float streak = fHash(vec2(floor(u * 1.7), seed * 91.0));
        plaster *= 0.94 + 0.06 * streak;
        plaster *= mix(0.86, 1.0, smoothstep(0.0, 2.5, y));
        float aa = max(fwidth(u), fwidth(y)) * 0.75 + 0.002;
        float rough = 0.92;
        float litWin = 0.0;
        if (style > 0.5 && style < 1.5) {
          // brick: courses of 7.5 cm, stretchers of 25 cm, pale mortar
          float ch = 0.075, bl = 0.25;
          float row = floor(y / ch);
          float bx = u / bl + 0.5 * mod(row, 2.0);
          float tone = fHash(vec2(floor(bx), row));
          float fade = smoothstep(0.012, 0.03, aa);
          float mortar = 1.0 - smoothstep(0.0, 0.14 + aa / ch, min(fract(y / ch), 1.0 - fract(y / ch)))
                       * smoothstep(0.0, 0.06 + aa / bl, min(fract(bx), 1.0 - fract(bx)));
          vec3 b = plaster * (0.82 + 0.3 * tone);
          plaster = mix(mix(b, vec3(0.62, 0.6, 0.55), mortar * 0.8), plaster * 1.02, fade);
        } else if (style > 1.5 && style < 2.5) {
          // ashlar: courses of 60 cm, blocks of 1.2 m, fine joints
          float row = floor(y / 0.6);
          float bx = u / 1.2 + 0.5 * mod(row, 2.0);
          float tone = fHash(vec2(floor(bx), row));
          float joint = 1.0 - smoothstep(0.0, 0.025 + aa / 0.6, min(fract(y / 0.6), 1.0 - fract(y / 0.6)))
                      * smoothstep(0.0, 0.012 + aa / 1.2, min(fract(bx), 1.0 - fract(bx)));
          plaster *= (0.93 + 0.1 * tone) * (1.0 - 0.28 * joint);
        } else if (style > 2.5) {
          // copper sheet: standing seams every 60 cm, streaks of patina
          float seam = 1.0 - smoothstep(0.0, 0.03 + aa, abs(fract(u / 0.6) - 0.5) * 0.6 - 0.27);
          plaster *= (0.9 + 0.15 * fHash(vec2(floor(u / 0.6), 3.0))) * (1.0 - 0.25 * seam);
          rough = 0.55;
        }
        vec3 col = plaster;

        // stone plinth
        float plinth = (1.0 - smoothstep(0.55 - aa, 0.6 + aa, y)) * step(style, 2.5) * step(y, 2.0);
        if (style > 3.5) plinth = 0.0;
        col = mix(col, vec3(0.42, 0.40, 0.37) * (0.9 + 0.1 * streak), plinth);

        // cornice: a light band and its shadow line just under the eaves
        float cTop = eave, cBot = eave - 0.45;
        if (style > 3.5) { cTop = -1.0; cBot = -2.0; }
        float cor = smoothstep(cBot - aa, cBot + aa, y) * (1.0 - smoothstep(cTop - aa, cTop + aa, y));
        col = mix(col, plaster * 1.12 + 0.03, cor);
        col *= 1.0 - 0.35 * smoothstep(cBot - 0.12 - aa, cBot - 0.12 + aa, y) * (1.0 - smoothstep(cBot - aa, cBot + aa, y));
        // storey bands on grand buildings
        if (grand) {
          float fy = mod(y - 0.6, storey);
          col *= 1.0 - 0.12 * (smoothstep(0.0, aa * 2.0, fy) * (1.0 - smoothstep(0.18, 0.18 + aa * 2.0, fy)));
        }

        // a dormer's front: one window filling it (aFac: top, bottom, width)
        bool dormer = style > 3.5;
        if (dormer) {
          vec2 p = vec2(u - L * 0.5, y);
          float lo = storey, hi = eave;
          float inner = fBox(p, vec2(-0.38, lo + 0.28), vec2(0.38, hi - 0.18), aa);
          float outer = fBox(p, vec2(-0.48, lo + 0.18), vec2(0.48, hi - 0.08), aa);
          vec3 frameC = mix(plaster * 1.15, vec3(0.86, 0.84, 0.8), 0.6);
          col = mix(col, frameC, outer);
          float bars = 1.0 - smoothstep(0.02, 0.02 + aa, abs(p.x));
          col = mix(col, mix(vec3(0.04, 0.045, 0.055), frameC, bars), inner);
          rough = mix(rough, 0.1, inner * (1.0 - bars));
        }
        // Reveals: windows and doors sit 25 cm into the wall. The glass is
        // drawn where the eye ray meets the plane 25 cm behind the facade,
        // so the opening's inner side shows on the side away from you.
        vec3 Vw = normalize(vWP - cameraPosition);
        vec3 Tw = normalize(vec3(-vWN.z, 0.0, vWN.x));
        float vn = max(0.2, -dot(Vw, vWN));
        vec2 par = vec2(dot(Vw, Tw), Vw.y) / vn * 0.25;
        // window bays
        float bay = church ? 5.5 : grand ? 4.0 : mix(2.9, 3.5, seed);
        float nb = max(1.0, floor(L / bay));
        float bw = L / nb;
        float bi = floor(u / bw);
        float x = (fract(u / bw) - 0.5) * bw;
        // ornate facades: a giant-order pilaster at every bay line from the
        // plinth to the cornice, and the middle three bays of a long wall
        // stepped forward as a risalit, a shade lighter
        if (ornate && !blank && nb >= 3.0 && y > 0.6 && y < eave - 0.45) {
          float edge = (0.5 - abs(fract(u / bw) - 0.5)) * bw;          // m to the nearest bay line
          float pil = 1.0 - smoothstep(0.3 - aa, 0.3 + aa, edge);
          bool risalit = nb >= 5.0 && abs(bi - floor(nb / 2.0)) <= 1.0 && mod(nb, 2.0) > 0.5;
          if (risalit) col *= 1.05;
          col = mix(col, plaster * 1.2 + 0.03, pil * step(0.5, u) * step(u, L - 0.5));
          col *= 1.0 - 0.3 * (smoothstep(0.3 - aa, 0.3, edge) - smoothstep(0.3, 0.4 + aa, edge)) * step(0.5, u) * step(u, L - 0.5);
        }
        float fy = y - 0.6;
        float si = floor(fy / storey);
        float ly = fy - si * storey;
        float ww = church ? 1.8 : grand ? 1.35 : 1.1;
        float wh = church ? storey * 0.75 : storey - 1.45;
        float wy0 = church ? storey * 0.15 : 0.95;
        // a window row only where the whole window fits below the cornice
        bool fits = !blank && !dormer && L > 2.0 && fy > 0.0 && 0.6 + si * storey + wy0 + wh < eave - 0.45;
        // the door: ground storey, the middle bay of a long enough wall
        bool door = !blank && si < 0.5 && nb >= 3.0 && abs(bi - floor(nb / 2.0)) < 0.5 && L > 7.0;
        if (fits) {
          float frame = 0.12;
          vec2 p = vec2(x, ly);
          vec2 a = door ? vec2(-0.75, -0.6) : vec2(-ww * 0.5, wy0);
          vec2 b = door ? vec2(0.75, 2.75) : vec2(ww * 0.5, wy0 + wh);
          float outer = fBox(p, a - frame, b + frame, aa);
          float opening = fBox(p, a, b, aa);
          float inner = opening * fBox(p + par, a, b, aa);
          float reveal = opening - inner;
          // arched heads on churches
          if (church) {
            float r = ww * 0.5;
            vec2 c = vec2(0.0, b.y);
            float arch = 1.0 - smoothstep(r - aa, r + aa, length(p - c));
            inner = max(inner * step(p.y, b.y), arch * step(b.y, p.y));
            outer = max(outer * step(p.y, b.y + frame), (1.0 - smoothstep(r + frame - aa, r + frame + aa, length(p - c))) * step(b.y, p.y));
          }
          vec3 frameC = mix(plaster * 1.15, vec3(0.86, 0.84, 0.8), 0.6);
          col = mix(col, frameC, outer);
          col = mix(col, plaster * 0.55, reveal);
          // the sill below
          float sill = fBox(p, vec2(a.x - 0.18, a.y - 0.2), vec2(b.x + 0.18, a.y - 0.08), aa);
          col = mix(col, plaster * 0.8, sill * (door ? 0.0 : 1.0));
          if (door) {
            // a panelled wooden door
            vec3 wood = mix(vec3(0.18, 0.11, 0.06), vec3(0.25, 0.2, 0.15), seed);
            float panel = fBox(vec2(abs(p.x) - 0.37, mod(p.y, 0.9)), vec2(-0.25, 0.12), vec2(0.25, 0.78), aa);
            col = mix(col, wood * (0.85 + 0.25 * panel), inner);
            rough = mix(rough, 0.7, inner);
          } else {
            // glass behind glazing bars: a cross and two more rows
            float bars = max(1.0 - smoothstep(0.025, 0.025 + aa, abs(p.x)),
                             1.0 - smoothstep(0.025, 0.025 + aa, abs(p.y - a.y - wh * 0.64)));
            vec3 glass = vec3(0.035, 0.04, 0.05) + 0.05 * fHash(vec2(bi, si + seed * 31.0));
            col = mix(col, mix(glass, frameC * 0.9, bars), inner);
            rough = mix(rough, mix(0.08, 0.6, bars), inner);
            // about a third of the rooms have a lamp lit at night
            float on = step(fHash(vec2(bi * 1.7 + seed * 13.0, si * 3.1 + L)), 0.33);
            litWin = inner * (1.0 - bars) * on;
          }
        }
        diffuseColor.rgb = col;
      `)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.6, 0.28) * litWin * uNight * 1.4;');
    sh.uniforms.uNight = nightLight;
  };
  m.customProgramCacheKey = () => 'facade';
  return m;
}

function roofMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoof;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoof = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoof;\nfloat rHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }')
      .replace('#include <map_fragment>', /* glsl */ `
        // rows of tiles up the slope, each tile a little different
        float rowH = 0.19, tw = 0.18;
        float row = floor(vRoof.y / rowH);
        float tx = vRoof.x / tw + 0.5 * mod(row, 2.0);
        float t = floor(tx);
        float aa = fwidth(vRoof.y / rowH) + 0.001;
        float fy = fract(vRoof.y / rowH);
        float shade = mix(0.72, 1.0, smoothstep(0.0, 0.25 + aa, fy));
        float gap = 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.1 + fwidth(tx), abs(fract(tx) - 0.5) * 2.0 - 0.9 + 0.1));
        // fade the pattern to its mean where it would alias
        float far = smoothstep(0.25, 0.6, aa);
        float v = mix(shade * gap * (0.86 + 0.24 * rHash(vec2(t, row))), 0.88, far);
        diffuseColor.rgb *= v;
      `);
  };
  m.customProgramCacheKey = () => 'roof';
  return m;
}

export const facadeMat = facadeMaterial();
export const roofMat = roofMaterial();

function wallGeometry(w: WallBuf) {
  const g = new THREE.BufferGeometry();
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
  g.computeBoundingSphere();
  return g;
}

export function buildBuildings(list: Building[]) {
  const group = new THREE.Group();
  group.name = 'buildings';
  const tiles = new Map<string, { w: WallBuf; r: RoofBuf }>();
  for (const b of list) {
    const [cx, cz] = centroid(b.outer);
    const key = Math.floor(cx / TILE) + ',' + Math.floor(cz / TILE);
    let t = tiles.get(key);
    if (!t) tiles.set(key, (t = { w: wallBuf(), r: roofBuf() }));
    try { buildMassing(b, t.w, t.r); } catch (e) { console.warn('building', b.id, e); }
  }
  for (const t of tiles.values()) {
    if (t.w.pos.length) {
      const m = new THREE.Mesh(wallGeometry(t.w), facadeMat);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
    if (t.r.pos.length) {
      const m = new THREE.Mesh(roofGeometry(t.r), roofMat);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
  }
  return group;
}
