import * as THREE from 'three';
import { camera, renderer, scene } from './renderer';
import { ATMO, LUT_GLSL } from './atmo';
import { WAVES_GLSL, waterTime } from './waves';
import { SUN_DIR, light, skyLUT, sun } from './sky';

/* ── From the scene to the screen ───────────────────────────────
   The scene renders in linear HDR into a multisampled half-float
   target with its depth; then, in full-screen passes:

     ao       ambient occlusion at half resolution from the depth
              alone (normals rebuilt from it), blurred along both
              axes without bleeding across depth edges
     composite  the occlusion applied; reflections on the water (the
              water writes alpha 0): the reflected ray is marched
              through the depth buffer to the house or tree it meets,
              or, where it leaves into the sky, the sky on screen in
              that direction is taken (clouds and sun with it), and
              the sky's table where that is off screen; then the
              haze: everything is dimmed by the air between it and
              the eye and takes on the sky's colour in its direction
              (the table the dome is drawn from, so far roofs melt
              into the horizon behind them)
     bloom    a pyramid of downsamples and tent-filtered upsamples;
              a small share of every pixel's light spread wide, as a
              lens does, so only what is very bright (the sun, lit
              lanterns at night) visibly glows
     final    exposure (sky.ts sets it from the light), AgX tone
              mapping with a gentle look, a lens's vignette, a little
              grain, dithered to 8 bits.

   The quality tier (quality.ts) sets the samples and switches the
   occlusion and the bloom. */

export const postSettings = { msaa: 4, ao: true, bloom: true, prepass: true };
// Objects on this layer (as well as 0) are drawn into the depth buffer
// before the full pass: large, costly to shade, and hiding much of each
// other and of the ground (the buildings). Nothing that discards
// fragments may be on it (the ground, over water; leaves).
export const PREPASS_LAYER = 1;
// pushed a hair back, so the full pass's own depth always passes
const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
// ?debug=ao shows the occlusion alone (for tuning, with the probe);
// ?off=ao,bloom,msaa,shadow switches parts off, to time them
const QUERY = new URLSearchParams(location.search);
const DEBUG = QUERY.get('debug');
const OFF = new Set((QUERY.get('off') ?? '').split(','));

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const quad = new THREE.Mesh(tri);
quad.frustumCulled = false;
const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
}
function draw(m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
  quad.material = m;
  renderer.setRenderTarget(target);
  renderer.render(quad, qCam);
}
const hdr = (w: number, h: number) => new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
});

// View-space position from the depth buffer.
const DEPTH_GLSL = /* glsl */ `
uniform sampler2D tDepth;
uniform vec4 uProj;   // P[0][0], P[1][1], near, far
float viewZ(float d) { return uProj.z * uProj.w / (uProj.w - d * (uProj.w - uProj.z)); }
vec3 viewPos(vec2 uv) {
  float z = viewZ(texture2D(tDepth, uv).r);
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x * z / uProj.x, ndc.y * z / uProj.y, -z);
}
`;

const proj = new THREE.Vector4();
const camWorld = new THREE.Matrix4();

/* ── Ambient occlusion ─────────────────────────────────────────
   Scalable Ambient Obscurance (McGuire et al. 2012), 12 taps on a
   spiral in a 2 m sphere, rotated per pixel by interleaved
   gradient noise; the blur after hides the pattern. Writes the
   occlusion and the view depth, for the bilateral blur and upsample. */
const aoMat = pass(/* glsl */ `
  ${DEPTH_GLSL}
  uniform vec2 uTexel;    // one full-resolution texel
  uniform float uR;
  varying vec2 vUv;
  void main() {
    // the centre of the full-resolution texel this half-res pixel
    // stands for (the half-res centre lies on a texel boundary, where
    // nearest sampling could pick either side)
    vec2 uv = (floor(gl_FragCoord.xy) * 2.0 + 0.5) * uTexel;
    vec3 P = viewPos(uv);
    float z = -P.z;
    if (z > 400.0) { gl_FragColor = vec4(1.0, z, 0.0, 1.0); return; }
    vec3 Pr = viewPos(uv + vec2(uTexel.x, 0.0)), Pl = viewPos(uv - vec2(uTexel.x, 0.0));
    vec3 Pt = viewPos(uv + vec2(0.0, uTexel.y)), Pb = viewPos(uv - vec2(0.0, uTexel.y));
    vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
    vec3 dy = abs(Pt.z - P.z) < abs(P.z - Pb.z) ? Pt - P : P - Pb;
    vec3 N = normalize(cross(dx, dy));
    float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    // the sphere's radius on screen, in uv
    vec2 rUV = uR * 0.5 * uProj.xy / z;
    float r2 = uR * uR, sum = 0.0;
    for (int i = 0; i < 12; i++) {
      float t = (float(i) + 0.5 + noise * 0.5) / 12.0;
      float a = float(i) * 2.3999632 + noise * 6.2831853;
      vec2 off = vec2(cos(a), sin(a)) * t * rUV;
      vec3 v = viewPos(uv + off) - P;
      float vv = dot(v, v), vn = dot(v, N);
      float f = max(r2 - vv, 0.0) / r2;
      sum += f * f * f * max((vn - 0.006 * z) / (vv + 0.02), 0.0);
    }
    float ao = max(0.0, 1.0 - sum * 3.2 / 12.0);
    ao = mix(ao, 1.0, smoothstep(200.0, 400.0, z));
    gl_FragColor = vec4(ao, z, 0.0, 1.0);
  }`, { tDepth: { value: null }, uProj: { value: proj }, uTexel: { value: new THREE.Vector2() }, uR: { value: 2.0 } });

const blurMat = pass(/* glsl */ `
  uniform sampler2D tAO;
  uniform vec2 uStep;
  varying vec2 vUv;
  void main() {
    vec2 c = texture2D(tAO, vUv).rg;
    float s = c.r, w = 1.0;
    for (int i = -4; i <= 4; i++) {
      if (i == 0) continue;
      vec2 q = texture2D(tAO, vUv + uStep * float(i)).rg;
      float k = exp(-float(i * i) / 10.0) * max(0.0, 1.0 - abs(q.g - c.g) / (0.03 * c.g + 0.05));
      s += q.r * k; w += k;
    }
    gl_FragColor = vec4(s / w, c.g, 0.0, 1.0);
  }`, { tAO: { value: null }, uStep: { value: new THREE.Vector2() } });

/* ── Composite: occlusion and haze ─────────────────────────────── */
const compMat = pass(/* glsl */ `
  ${DEPTH_GLSL}
  uniform sampler2D tColor, tAO, tLUT;
  uniform vec2 uAOTexel;
  uniform float uAO, uDebug, uT;
  uniform vec2 uRes;
  uniform mat4 uCamWorld, uView, uProjM;
  uniform vec3 uSun, uExt;
  varying vec2 vUv;
  ${LUT_GLSL}
  ${WAVES_GLSL}
  vec2 project(vec3 q) { vec4 c = uProjM * vec4(q, 1.0); return c.xy / c.w * 0.5 + 0.5; }
  bool onScreen(vec2 uv) { return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))); }
  // what the water mirrors at view-space point P, normal n (view space)
  vec3 reflection(vec3 P, vec3 n) {
    vec3 V = normalize(P), R = reflect(V, n);
    if (R.z > -0.02 * length(R.xy)) R.z = -0.02 * length(R.xy);   // keep marching away from the eye's plane
    R = normalize(R);
    float t = 0.4, tPrev = 0.0;
    for (int i = 0; i < 26; i++) {
      vec3 Q = P + R * t;
      vec2 uv = project(Q);
      if (!onScreen(uv) || -Q.z < uProj.z) break;
      float zs = viewZ(texture2D(tDepth, uv).r);
      if (-Q.z > zs && -Q.z - zs < max(1.0, (t - tPrev) * 1.5) && zs < uProj.w * 0.99) {
        // passed behind a surface: close in on where it was met
        float a = tPrev, b = t;
        for (int j = 0; j < 5; j++) {
          float m = 0.5 * (a + b);
          vec3 M = P + R * m;
          if (-M.z > viewZ(texture2D(tDepth, project(M)).r)) b = m; else a = m;
        }
        vec2 h = project(P + R * b);
        // fade out toward the screen's edges, where the ray would soon have left
        vec2 e = smoothstep(vec2(0.0), vec2(0.08), h) * smoothstep(vec2(1.0), vec2(0.92), h);
        vec3 sky = skyLUT(tLUT, normalize((uCamWorld * vec4(R, 0.0)).xyz * vec3(1.0, 0.0, 1.0) + vec3(0.0, abs((uCamWorld * vec4(R, 0.0)).y), 0.0)), uSun);
        return mix(sky, texture2D(tColor, h).rgb, e.x * e.y);
      }
      tPrev = t;
      t *= 1.32;
    }
    // into the sky: the sky on screen in that direction, else the table
    vec3 Rw = (uCamWorld * vec4(R, 0.0)).xyz;
    vec2 inf = project(P + R * 5000.0);
    vec3 sky = skyLUT(tLUT, normalize(vec3(Rw.x, max(Rw.y, 0.0), Rw.z)), uSun);
    if (onScreen(inf) && texture2D(tDepth, inf).r >= 1.0) {
      vec2 e = smoothstep(vec2(0.0), vec2(0.05), inf) * smoothstep(vec2(1.0), vec2(0.95), inf);
      return mix(sky, texture2D(tColor, inf).rgb, e.x * e.y);
    }
    return sky;
  }
  void main() {
    vec4 C = texture2D(tColor, vUv);
    vec3 col = C.rgb;
    float d = texture2D(tDepth, vUv).r;
    if (d < 1.0) {
      vec3 P = viewPos(vUv);
      float z = -P.z;
      if (C.a < 0.01) {
        vec3 Pw = (uCamWorld * vec4(P, 1.0)).xyz;
        // a pixel's size on the water, stretched where the eye looks along it
        vec3 up = (uView * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
        float pix = length(P) * 2.0 / (uProj.y * uRes.y) / max(abs(dot(normalize(P), up)), 0.08);
        vec2 g = waterSlope(Pw.xz, uT, pix);
        vec3 n = normalize((uView * vec4(-g.x, 1.0, -g.y, 0.0)).xyz);
        float cosV = max(dot(-normalize(P), n), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
        col += reflection(P, n) * F;
      }
      if (uAO > 0.0) {
        // joint bilateral upsample: the four nearest half-res texels,
        // weighted by how close their depth is to this pixel's
        vec2 b = vUv / uAOTexel - 0.5, f = fract(b), o = (floor(b) + 0.5) * uAOTexel;
        vec2 s00 = texture2D(tAO, o).rg, s10 = texture2D(tAO, o + vec2(uAOTexel.x, 0.0)).rg;
        vec2 s01 = texture2D(tAO, o + vec2(0.0, uAOTexel.y)).rg, s11 = texture2D(tAO, o + uAOTexel).rg;
        vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y)
               / (vec4(abs(s00.g - z), abs(s10.g - z), abs(s01.g - z), abs(s11.g - z)) / (0.02 * z + 0.05) + 1e-3);
        float ao = dot(w, vec4(s00.r, s10.r, s01.r, s11.r)) / dot(w, vec4(1.0));
        col *= mix(1.0, ao, uAO);
        if (uDebug > 0.5) { gl_FragColor = vec4(vec3(ao * 0.5), 1.0); return; }
      }
      vec3 dir = normalize((uCamWorld * vec4(P, 0.0)).xyz);
      float dist = length(P);
      vec3 T = exp(-uExt * dist);
      vec3 hz = skyLUT(tLUT, normalize(vec3(dir.x, max(dir.y, 0.003), dir.z)), uSun);
      col = col * T + hz * (1.0 - T);
    }
    gl_FragColor = vec4(col, 1.0);
  }`, {
  tColor: { value: null }, tDepth: { value: null }, tAO: { value: null }, tLUT: { value: skyLUT },
  uProj: { value: proj }, uAOTexel: { value: new THREE.Vector2() }, uAO: { value: 1 }, uDebug: { value: DEBUG === 'ao' ? 1 : 0 }, uCamWorld: { value: camWorld },
  uView: { value: camera.matrixWorldInverse }, uProjM: { value: camera.projectionMatrix }, uT: waterTime, uRes: { value: new THREE.Vector2() },
  uSun: { value: SUN_DIR },
  // the haze's extinction at the ground: air and aerosols
  uExt: { value: new THREE.Vector3(...ATMO.rayleigh.map((r) => r + ATMO.mieS + ATMO.mieA)) },
});

/* ── Bloom ──────────────────────────────────────────────────────
   Downsampling with the 13-tap filter of Jimenez (2014), the first
   step holding back single blazing pixels; upsampling with a 3×3
   tent, each level adding the one below it. */
const downMat = pass(/* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uFirst;
  varying vec2 vUv;
  vec3 s(vec2 o) { vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb; return uFirst > 0.5 ? c / (1.0 + max(max(c.r, c.g), c.b) / 64.0) : c; }
  void main() {
    vec3 c = s(vec2(0.0)) * 0.125;
    c += (s(vec2(-2.0, 2.0)) + s(vec2(2.0, 2.0)) + s(vec2(-2.0, -2.0)) + s(vec2(2.0, -2.0))) * 0.03125;
    c += (s(vec2(0.0, 2.0)) + s(vec2(-2.0, 0.0)) + s(vec2(2.0, 0.0)) + s(vec2(0.0, -2.0))) * 0.0625;
    c += (s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0)) + s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0))) * 0.125;
    gl_FragColor = vec4(c, 1.0);
  }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } });
const upMat = pass(/* glsl */ `
  uniform sampler2D tLow, tHigh;
  uniform vec2 uTexel;
  varying vec2 vUv;
  vec3 s(vec2 o) { return texture2D(tLow, vUv + o * uTexel).rgb; }
  void main() {
    vec3 c = s(vec2(0.0)) * 4.0;
    c += (s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, -1.0)) + s(vec2(0.0, 1.0))) * 2.0;
    c += s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0));
    gl_FragColor = vec4(texture2D(tHigh, vUv).rgb + c / 16.0, 1.0);
  }`, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() } });

/* ── Final: exposure, tone, lens ───────────────────────────────── */
const finalMat = pass(/* glsl */ `
  uniform sampler2D tComp, tBloom;
  uniform float uBloom, uExposure, uTime;
  uniform vec2 uRes;
  varying vec2 vUv;
  // AgX (Sobotka), the minimal fit of Wrensch (2023): a filmic curve
  // that rolls highlights off toward white instead of skewing hues.
  vec3 agxCurve(vec3 x) {
    vec3 x2 = x * x, x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }
  vec3 agx(vec3 c) {
    const mat3 inset = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                            0.0784335999999992, 0.878468636469772, 0.0784336,
                            0.0792237451477643, 0.0791661274605434, 0.879142973793104);
    const mat3 outset = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                             -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                             -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
    const float lo = -12.47393, hi = 4.026069;
    c = inset * c;
    c = clamp(log2(max(c, 1e-10)), lo, hi);
    c = agxCurve((c - lo) / (hi - lo));
    // a gentle look: a touch more contrast and colour than AgX's base
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = pow(max(c, 0.0), vec3(1.08));
    c = l + 1.12 * (c - l);
    return outset * c;
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    vec3 c = texture2D(tComp, vUv).rgb;
    if (uBloom > 0.0) c = mix(c, texture2D(tBloom, vUv).rgb, uBloom);
    c *= uExposure;
    // natural vignetting: a lens passes less light toward the corners
    vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    c *= 1.0 / pow(1.0 + dot(q, q) * 0.55, 2.0);
    c = clamp(agx(c), 0.0, 1.0);
    // grain, stronger in the shadows as on film, and dither
    float g = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) + hash(gl_FragCoord.yx * 1.37 + fract(uTime * 3.7) * 71.0) - 1.0;
    c += g * (0.012 * (1.0 - c) + 1.5 / 255.0);
    gl_FragColor = vec4(c, 1.0);
  }`, {
  tComp: { value: null }, tBloom: { value: null }, uBloom: { value: 0.035 }, uExposure: { value: 1 },
  uTime: { value: 0 }, uRes: { value: new THREE.Vector2() },
});

/* ── Targets ────────────────────────────────────────────────────── */
let W = 0, H = 0, samples = -1;
let sceneRT: THREE.WebGLRenderTarget, compRT: THREE.WebGLRenderTarget, aoA: THREE.WebGLRenderTarget, aoB: THREE.WebGLRenderTarget;
const down: THREE.WebGLRenderTarget[] = [], up: THREE.WebGLRenderTarget[] = [];
const size = new THREE.Vector2();

function allocate() {
  for (const t of [sceneRT, compRT, aoA, aoB, ...down, ...up]) t?.dispose();
  down.length = up.length = 0;
  sceneRT = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  });
  sceneRT.depthTexture = new THREE.DepthTexture(W, H, THREE.UnsignedIntType);
  sceneRT.depthTexture.minFilter = sceneRT.depthTexture.magFilter = THREE.NearestFilter;
  compRT = hdr(W, H);
  const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
  aoA = hdr(hw, hh); aoB = hdr(hw, hh);
  let w = hw, h = hh;
  // (tiny targets are slow on some drivers: a 20×11 level once cost
  // 30 ms a frame on an Intel GPU under Mesa, so the pyramid stops early)
  for (let i = 0; i < 6 && Math.min(w, h) >= 24; i++) {
    down.push(hdr(w, h));
    up.push(hdr(w, h));
    w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
  }
}

const clock = new THREE.Clock();
renderer.info.autoReset = false;
export function renderFrame() {
  renderer.info.reset();
  renderer.getDrawingBufferSize(size);
  if (OFF.size > 1 || OFF.has('ao') || OFF.has('bloom') || OFF.has('msaa') || OFF.has('shadow')) {
    if (OFF.has('shadow')) sun.castShadow = renderer.shadowMap.enabled = false;
    if (OFF.has('ao')) postSettings.ao = false;
    if (OFF.has('bloom')) postSettings.bloom = false;
    if (OFF.has('msaa')) postSettings.msaa = 0;
  }
  const msaa = renderer.capabilities.isWebGL2 ? Math.min(postSettings.msaa, renderer.capabilities.maxSamples) : 0;
  if (size.x !== W || size.y !== H || msaa !== samples) { W = size.x; H = size.y; samples = msaa; allocate(); }

  renderer.setRenderTarget(sceneRT);
  if (postSettings.prepass && !OFF.has('prepass')) {
    // Depth first, for what is costly to shade and hides much (layer 1:
    // the buildings): then the full pass shades only what is seen.
    // Shadows are drawn once, in the full pass.
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    camera.layers.set(PREPASS_LAYER);
    scene.overrideMaterial = depthOnly;
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    camera.layers.set(0);
    renderer.shadowMap.autoUpdate = auto;
    renderer.shadowMap.needsUpdate = true;
    renderer.autoClearDepth = false;
    renderer.render(scene, camera);
    renderer.autoClearDepth = true;
  } else renderer.render(scene, camera);

  const e = camera.projectionMatrix.elements;
  proj.set(e[0]!, e[5]!, camera.near, camera.far);
  camWorld.copy(camera.matrixWorld);

  const ao = postSettings.ao;
  if (ao) {
    aoMat.uniforms.tDepth!.value = sceneRT.depthTexture;
    aoMat.uniforms.uTexel!.value.set(1 / W, 1 / H);
    draw(aoMat, aoA);
    blurMat.uniforms.tAO!.value = aoA.texture;
    blurMat.uniforms.uStep!.value.set(1 / aoA.width, 0);
    draw(blurMat, aoB);
    blurMat.uniforms.tAO!.value = aoB.texture;
    blurMat.uniforms.uStep!.value.set(0, 1 / aoA.height);
    draw(blurMat, aoA);
  }
  const cu = compMat.uniforms;
  cu.tColor!.value = sceneRT.texture;
  cu.tDepth!.value = sceneRT.depthTexture;
  cu.tAO!.value = aoA.texture;
  cu.uAO!.value = ao ? 1 : 0;
  cu.uAOTexel!.value.set(1 / aoA.width, 1 / aoA.height);
  cu.uRes!.value.set(W, H);
  draw(compMat, compRT);

  const fu = finalMat.uniforms;
  if (postSettings.bloom && down.length > 1) {
    let src = compRT;
    down.forEach((t, i) => {
      downMat.uniforms.tSrc!.value = src.texture;
      downMat.uniforms.uTexel!.value.set(1 / src.width, 1 / src.height);
      downMat.uniforms.uFirst!.value = i === 0 ? 1 : 0;
      draw(downMat, t);
      src = t;
    });
    // up[i]: level i with every smaller level added
    let low = down[down.length - 1]!;
    for (let i = down.length - 2; i >= 0; i--) {
      const target = up[i]!;
      upMat.uniforms.tLow!.value = low.texture;
      upMat.uniforms.tHigh!.value = down[i]!.texture;
      upMat.uniforms.uTexel!.value.set(1 / low.width, 1 / low.height);
      draw(upMat, target);
      low = target;
    }
    fu.tBloom!.value = low.texture;
    fu.uBloom!.value = 0.04 / down.length;
  } else fu.uBloom!.value = 0;

  fu.tComp!.value = compRT.texture;
  fu.uExposure!.value = light.exposure;
  fu.uTime!.value = clock.getElapsedTime();
  fu.uRes!.value.set(W, H);
  draw(finalMat, null);
}
