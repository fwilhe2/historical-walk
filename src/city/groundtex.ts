import * as THREE from 'three';

/* ── Ground textures, baked ─────────────────────────────────────
   The surfaces of the streets and the open ground, drawn once at load
   on the GPU into two texture arrays (one layer per surface, each a
   seamless tile), then mipmapped, so they are crisp underfoot and
   do not shimmer far off:

     A   albedo (rgb), roughness (a)
     N   normal (rg, tangent space: x across the tile, y up it),
         height (b), occlusion of the sky by the relief itself (a)

   The surfaces, at their tile sizes:
     0 SETTS   granite setts, about 17 × 15 cm, in rows (2.4 m)
     1 SLABS   granite paving slabs, a band of four along the tile (1.3 × 4.8 m)
     2 MOSAIC  small paving cubes, 5–6 cm, light and dark (1.2 m)
     3 GRAVEL  sand and pebbles (2 m)
     4 GRASS   a mown lawn, clumps and bare patches (2 m)
     5 EARTH   trodden earth with grit (3 m)

   The ground shader (ground.ts) lays them in street coordinates and
   blends them; all of it is generic old-town paving, no city's own. */

export const GROUND_LAYERS = { SETTS: 0, SLABS: 1, MOSAIC: 2, GRAVEL: 3, GRASS: 4, EARTH: 5 } as const;
export const GROUND_TILE = [2.4, [1.3, 4.8], 1.2, 2.0, 2.0, 3.0] as const;
const N_LAYERS = 6, SIZE = 1024;

const BAKE = /* glsl */ `
precision highp float;
uniform float uLayer, uMode;
varying vec2 vUv;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash2(vec2 p) { float n = hash(p); return vec2(n, hash(p + n * 17.17 + 3.1)); }
// value noise and fbm, periodic over the tile (x in [0,1), per: whole lattice cells per tile)
float vnoise(vec2 x, vec2 per) {
  vec2 p = x * per, i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float a = hash(mod(i, per)), b = hash(mod(i + vec2(1.0, 0.0), per));
  float c = hash(mod(i + vec2(0.0, 1.0), per)), d = hash(mod(i + 1.0, per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float vnoise(vec2 x, float per) { return vnoise(x, vec2(per)); }
float fbm(vec2 x, vec2 per, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * vnoise(x + float(i) * 0.37, per); n += a; per *= 2.0; a *= 0.5; }
  return s / n;
}
float fbm(vec2 x, float per, int oct) { return fbm(x, vec2(per), oct); }
// jittered cells on an n×n grid, periodic: (distance to the nearest
// centre, distance to the cell's edge (F2 − F1, in cell units), cell id)
vec4 cells(vec2 x, float n, float jit) {
  vec2 p = x * n, i = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int k = -1; k <= 1; k++) {
    vec2 g = vec2(float(k), float(y));
    vec2 c = mod(i + g, n);
    vec2 r = g + 0.5 + (hash2(c) - 0.5) * jit - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = c; } else if (d < d2) d2 = d;
  }
  return vec4(sqrt(d1), sqrt(d2) - sqrt(d1), id);
}
// granite: a base tone, then dark mica and light feldspar in specks
vec3 granite(vec2 x, vec3 base, vec2 scale) {
  float a = vnoise(x, scale), b = vnoise(x + 0.31, scale * 0.7), c = vnoise(x + 0.73, scale * 0.8);
  vec3 col = base * (0.82 + 0.36 * a);
  col = mix(col, vec3(0.045, 0.045, 0.05), smoothstep(0.72, 0.88, b) * 0.75);
  col = mix(col, base * 1.6 + 0.05, smoothstep(0.78, 0.95, c) * 0.45);
  return col;
}

struct G { vec3 a; float r; float h; float o; };

/* Setts in rows: stones of jittered width, each row offset, edges
   hand-cut (noisy), tops domed and worn smooth, sand and dirt in
   the joints. */
G setts(vec2 x) {
  const float T = 2.4, NR = 16.0, NS = 14.0;
  vec2 m = x * T;
  float rowH = T / NR, W = T / NS;
  float r = mod(floor(m.y / rowH), NR);
  float xs = mod(m.x + hash(vec2(r, 3.0)) * T, T);
  float k = floor(xs / W);
  float b0 = k * W + (hash(vec2(mod(k, NS), r)) - 0.5) * 0.07;
  float b1 = (k + 1.0) * W + (hash(vec2(mod(k + 1.0, NS), r)) - 0.5) * 0.07;
  if (xs < b0) { k -= 1.0; b1 = b0; b0 = k * W + (hash(vec2(mod(k, NS), r)) - 0.5) * 0.07; }
  else if (xs > b1) { k += 1.0; b0 = b1; b1 = (k + 1.0) * W + (hash(vec2(mod(k + 1.0, NS), r)) - 0.5) * 0.07; }
  vec2 sid = vec2(mod(k, NS), r);
  float fy = m.y - floor(m.y / rowH) * rowH;
  float t0 = (hash(sid + 7.1) - 0.5) * 0.018, t1 = rowH + (hash(sid + 3.3) - 0.5) * 0.018;
  float ex = min(xs - b0, b1 - xs), ey = min(fy - t0, t1 - fy);
  float cr = 0.035;
  float e = (ex < cr && ey < cr) ? cr - length(vec2(cr - ex, cr - ey)) : min(ex, ey);
  e += (fbm(x + hash(sid), 64.0, 3) - 0.5) * 0.018;
  float joint = 0.008;
  float inside = smoothstep(joint, joint + 0.004, e);
  vec2 lc = vec2((xs - 0.5 * (b0 + b1)) / (b1 - b0), (fy - 0.5 * (t0 + t1)) / (t1 - t0));
  float dome = smoothstep(joint, joint + 0.05, e) * (1.0 - 0.6 * dot(lc, lc));
  float tilt = dot(lc, hash2(sid + 9.0) - 0.5) * 0.35;
  float sand = fbm(x, 192.0, 3);
  float hs = 0.5 + 0.38 * dome + tilt * 0.25 + (vnoise(x, 300.0) - 0.5) * 0.04;
  float hj = 0.12 + 0.12 * sand;
  float t = hash(sid + 1.3);
  vec3 base = t < 0.45 ? vec3(0.19, 0.185, 0.178) : t < 0.65 ? vec3(0.205, 0.182, 0.168) : t < 0.88 ? vec3(0.16, 0.165, 0.172) : vec3(0.1, 0.097, 0.094);
  base *= 0.82 + 0.3 * hash(sid + 5.5);
  vec3 c = granite(x, base, vec2(700.0));
  float top = smoothstep(0.03, 0.07, e);
  c = mix(c, c * vec3(0.86, 0.82, 0.78), top * 0.45);          // worn, a little greasy, on top
  c *= mix(0.62, 1.0, smoothstep(joint, joint + 0.035, e));      // dirt toward the joints
  vec3 dirt = mix(vec3(0.055, 0.047, 0.037), vec3(0.11, 0.095, 0.074), sand);
  G g;
  g.a = mix(dirt, c, inside);
  g.r = mix(0.97, mix(0.8, 0.58, top), inside);
  g.h = mix(hj, hs, inside);
  g.o = mix(0.45, mix(0.8, 1.0, top), inside);
  return g;
}

/* Granite slabs: one across the band, four of jittered length along
   it, sawn faces with stains, chipped arrises, each tilted a little
   as old paving settles. */
G slabs(vec2 x) {
  const vec2 T = vec2(1.3, 4.8);
  vec2 m = x * T;
  float L = T.y / 4.0;
  float k = floor(m.y / L);
  float b0 = k * L + (hash(vec2(mod(k, 4.0), 1.0)) - 0.5) * 0.4, b1 = (k + 1.0) * L + (hash(vec2(mod(k + 1.0, 4.0), 1.0)) - 0.5) * 0.4;
  if (m.y < b0) { k -= 1.0; b1 = b0; b0 = k * L + (hash(vec2(mod(k, 4.0), 1.0)) - 0.5) * 0.4; }
  else if (m.y > b1) { k += 1.0; b0 = b1; b1 = (k + 1.0) * L + (hash(vec2(mod(k + 1.0, 4.0), 1.0)) - 0.5) * 0.4; }
  vec2 sid = vec2(mod(k, 4.0), 2.0);
  float e = min(min(m.x, T.x - m.x), min(m.y - b0, b1 - m.y));
  e += (fbm(x, 40.0, 3) - 0.5) * 0.012;
  float inside = smoothstep(0.004, 0.008, e);
  vec2 lc = vec2(m.x / T.x - 0.5, (m.y - 0.5 * (b0 + b1)) / (b1 - b0));
  float tilt = dot(lc, hash2(sid + 4.0) - 0.5) * 0.5;
  float t = hash(sid + 2.0);
  vec3 base = mix(vec3(0.30, 0.295, 0.28), vec3(0.26, 0.25, 0.245), t);
  vec3 c = granite(x, base, vec2(500.0, 1850.0));
  // stains and wear: footsteps polish the middle, the edges keep dirt
  float st = fbm(x + hash(sid), vec2(6.0, 22.0), 5);
  c *= 0.82 + 0.3 * st;
  c *= mix(0.7, 1.0, smoothstep(0.004, 0.03, e));
  G g;
  g.a = mix(vec3(0.07, 0.065, 0.055), c, inside);
  g.r = mix(0.95, 0.68 + 0.15 * (1.0 - st), inside);
  g.h = mix(0.2, 0.6 + tilt * 0.3 + (vnoise(x, vec2(220.0, 812.0)) - 0.5) * 0.03, inside);
  g.o = mix(0.5, 1.0, smoothstep(0.004, 0.02, e));
  return g;
}

/* Mosaic paving: small cubes set in sand, mostly grey, some white
   limestone and some dark basalt. */
G mosaic(vec2 x) {
  vec4 v = cells(x, 22.0, 0.75);
  float e = v.y / 22.0 * 1.2;   // m to the cube's edge
  float inside = smoothstep(0.004, 0.007, e);
  float t = hash(v.zw);
  vec3 base = t < 0.72 ? vec3(0.22, 0.212, 0.2) : t < 0.88 ? vec3(0.36, 0.345, 0.32) : vec3(0.07, 0.07, 0.075);
  base *= 0.85 + 0.3 * hash(v.zw + 3.0);
  vec3 c = granite(x, base, vec2(600.0)) * mix(0.7, 1.0, smoothstep(0.005, 0.02, e));
  float sand = fbm(x, 150.0, 3);
  G g;
  g.a = mix(mix(vec3(0.12, 0.105, 0.08), vec3(0.2, 0.18, 0.14), sand), c, inside);
  g.r = mix(0.95, 0.72, inside);
  g.h = mix(0.15 + 0.1 * sand, 0.55 + 0.3 * smoothstep(0.005, 0.02, e), inside);
  g.o = mix(0.5, 1.0, smoothstep(0.005, 0.02, e));
  return g;
}

/* Gravel: rounded pebbles of a few sizes, in sand. */
G gravel(vec2 x) {
  vec4 a = cells(x, 70.0, 0.9), b = cells(x + 0.5, 140.0, 0.9);
  float pa = smoothstep(0.05, 0.25, a.y), pb = smoothstep(0.05, 0.25, b.y);
  float sand = fbm(x, 64.0, 4);
  vec3 s = mix(vec3(0.16, 0.135, 0.1), vec3(0.23, 0.195, 0.15), sand);
  vec3 ca = mix(vec3(0.24, 0.21, 0.17), vec3(0.16, 0.155, 0.15), hash(a.zw)) * (0.7 + 0.5 * hash(a.zw + 1.0));
  vec3 cb = mix(vec3(0.27, 0.235, 0.18), vec3(0.13, 0.125, 0.12), hash(b.zw)) * (0.7 + 0.5 * hash(b.zw + 1.0));
  float ua = pa * step(0.35, hash(a.zw + 2.0)), ub = pb * step(0.2, hash(b.zw + 2.0)) * (1.0 - ua);
  G g;
  g.a = mix(mix(s, cb, ub), ca, ua);
  g.r = 0.93;
  g.h = 0.3 * sand + 0.35 * ub * (1.0 - b.x) + 0.6 * ua * (1.0 - a.x * 0.8);
  g.o = mix(0.6, 1.0, max(ua, ub * 0.8) + sand * 0.3);
  return g;
}

/* A mown lawn: blades as streaky noise, clumps, clover, a few bare
   patches of soil. */
G grass(vec2 x) {
  float clump = fbm(x, 6.0, 4);
  float blades = vnoise(x, vec2(512.0, 128.0)) * 0.6 + vnoise(x + 0.3, vec2(128.0, 512.0)) * 0.4;
  float fine = vnoise(x, 900.0);
  float bare = smoothstep(0.66, 0.78, fbm(x + 0.5, 4.0, 5));
  vec3 c = mix(vec3(0.035, 0.06, 0.012), vec3(0.09, 0.13, 0.03), clump);
  c = mix(c, vec3(0.13, 0.14, 0.04), smoothstep(0.6, 0.9, blades) * 0.6);       // sunlit tips, dry
  c *= 0.7 + 0.6 * fine;
  c = mix(c, vec3(0.1, 0.08, 0.055) * (0.8 + 0.4 * fine), bare * 0.85);
  G g;
  g.a = c;
  g.r = mix(0.9, 0.97, bare);
  g.h = 0.4 + 0.35 * blades * (1.0 - bare) + 0.15 * clump;
  g.o = mix(0.65, 1.0, blades * (1.0 - bare) + bare);
  return g;
}

/* Trodden earth: brown-grey soil, grit, cracks where it dried. */
G earth(vec2 x) {
  float n = fbm(x, 8.0, 5), f = vnoise(x, 600.0);
  vec4 cr = cells(x, 9.0, 0.9);
  float crack = 1.0 - smoothstep(0.0, 0.035, cr.y);
  vec4 gr = cells(x, 160.0, 0.9);
  float grit = smoothstep(0.1, 0.3, gr.y) * step(0.7, hash(gr.zw));
  vec3 c = mix(vec3(0.11, 0.088, 0.062), vec3(0.19, 0.155, 0.11), n) * (0.85 + 0.3 * f);
  c = mix(c, vec3(0.26, 0.24, 0.21) * (0.7 + 0.6 * hash(gr.zw + 1.0)), grit * 0.8);
  c *= 1.0 - 0.45 * crack * smoothstep(0.4, 0.7, n);
  G g;
  g.a = c;
  g.r = 0.96;
  g.h = 0.4 + 0.3 * n + 0.2 * grit - 0.25 * crack * smoothstep(0.4, 0.7, n);
  g.o = mix(1.0, 0.6, crack * smoothstep(0.4, 0.7, n));
  return g;
}

G surface(vec2 x) {
  if (uLayer < 0.5) return setts(x);
  if (uLayer < 1.5) return slabs(x);
  if (uLayer < 2.5) return mosaic(x);
  if (uLayer < 3.5) return gravel(x);
  if (uLayer < 4.5) return grass(x);
  return earth(x);
}

void main() {
  vec2 x = vUv;
  G g = surface(x);
  if (uMode < 0.5) { gl_FragColor = vec4(g.a, g.r); return; }
  // the normal from the height: relief in metres (a few cm), over the tile's size
  vec2 T = uLayer < 0.5 ? vec2(2.4) : uLayer < 1.5 ? vec2(1.3, 4.8) : uLayer < 2.5 ? vec2(1.2) : uLayer < 4.5 ? vec2(2.0) : vec2(3.0);
  float relief = uLayer < 0.5 ? 0.045 : uLayer < 1.5 ? 0.01 : uLayer < 2.5 ? 0.025 : uLayer < 3.5 ? 0.02 : uLayer < 4.5 ? 0.03 : 0.025;
  float e = 1.0 / ${SIZE.toFixed(1)};
  float hx = surface(x + vec2(e, 0.0)).h - surface(x - vec2(e, 0.0)).h;
  float hy = surface(x + vec2(0.0, e)).h - surface(x - vec2(0.0, e)).h;
  vec3 n = normalize(vec3(-hx * relief / (2.0 * e * T.x), -hy * relief / (2.0 * e * T.y), 1.0));
  gl_FragColor = vec4(n.xy * 0.5 + 0.5, g.h, g.o);
}
`;

/* Draw the layers, then mipmap the arrays. three r160 mipmaps array
   render targets as plain 2D textures (and fails), so the targets are
   made without mipmaps and the arrays mipmapped here, directly. */
export function bakeGroundTextures(renderer: THREE.WebGLRenderer) {
  const make = () => {
    const rt = new THREE.WebGLArrayRenderTarget(SIZE, SIZE, N_LAYERS, { depthBuffer: false });
    const t = rt.texture;
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return rt;
  };
  const A = make(), N = make();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uLayer: { value: 0 }, uMode: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: BAKE,
    depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  for (const [rt, mode] of [[A, 0], [N, 1]] as const) {
    for (let l = 0; l < N_LAYERS; l++) {
      mat.uniforms.uLayer!.value = l;
      mat.uniforms.uMode!.value = mode;
      renderer.setRenderTarget(rt, l);
      renderer.render(quad, cam);
    }
  }
  renderer.setRenderTarget(prev);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  for (const rt of [A, N]) {
    const tex = (renderer.properties.get(rt.texture) as { __webglTexture: WebGLTexture }).__webglTexture;
    renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    renderer.state.unbindTexture();
  }
  mat.dispose(); quad.geometry.dispose();
  return { albedo: A.texture, normal: N.texture };
}
