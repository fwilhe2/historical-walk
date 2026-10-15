import * as THREE from 'three';
import { renderer, scene } from './renderer';
import { LUT_GLSL } from './atmo';
import { SUN_DIR, light, skyLUT } from './sky';

/* ── Clouds ─────────────────────────────────────────────────────
   Fair-weather cumulus in a layer at 1.2 km, drawn on a plane that
   follows the eye. Their shapes and their light are baked into a map
   20 km across, now and then, and the wind slides the map along in
   between, so the sky drifts smoothly at the cost of a few texture
   reads a pixel:

     density   where the clouds are (warped fbm), and the heaps they
               are made of (cellular noise), cut at the cover
     sunlight  how much of the sun gets through to each point of the
               layer: the density summed along the sun's slant path
               up through the layer's 600 m, as light through cloud
               falls off (Beer)

   The plane then adds fine detail at the edges, and lights each pixel:
   the sun through the cloud, forward-scattered (bright silver edges
   toward the sun), darker in the thick of a heap where light comes
   from deep inside ("powder"), the sky's light from above, the bases
   of thick clouds grey; and far clouds sink into the haze. */

const RES = 1024, SPAN = 20000, ALT = 1200, LAYER = 600;
const WIND = new THREE.Vector2(3.6, 1.35);   // m/s, from the west-southwest
export const cloudSettings = { cover: 0.5 };

const mapRT = (type: THREE.TextureDataType) => new THREE.WebGLRenderTarget(RES, RES, {
  type, format: THREE.RGBAFormat, depthBuffer: false,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
  wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
});
const densRT = mapRT(THREE.UnsignedByteType), litRT = mapRT(THREE.UnsignedByteType);
const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const NOISE = /* glsl */ `
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h2(vec2 p) { return vec2(h(p), h(p + 19.19)); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p, int oct) { float a = 0.5, s = 0.0, t = 0.0; for (int i = 0; i < 6; i++) { if (i >= oct) break; s += a * n(p); t += a; p = p * 2.03 + 7.1; a *= 0.5; } return s / t; }
float cellular(vec2 p) {
  vec2 i = floor(p), f = fract(p); float d = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)); vec2 r = g + h2(i + g) - f; d = min(d, dot(r, r)); }
  return sqrt(d);
}
`;
const densMat = new THREE.ShaderMaterial({
  vertexShader: VERT, depthTest: false, depthWrite: false,
  uniforms: { uCenter: { value: new THREE.Vector2() }, uWind: { value: new THREE.Vector2() }, uCover: { value: 0.5 } },
  fragmentShader: /* glsl */ `
    uniform vec2 uCenter, uWind; uniform float uCover;
    varying vec2 vUv;
    ${NOISE}
    void main() {
      vec2 q = (uCenter + (vUv - 0.5) * ${SPAN.toFixed(1)} + uWind) / 1500.0;
      vec2 w = vec2(fbm(q * 0.6 + 1.7, 4), fbm(q * 0.6 + 8.3, 4)) - 0.5;
      float big = fbm(q + w * 0.9, 5);
      float heaps = 1.0 - cellular(q * 2.6 + w * 1.5);
      float small = 1.0 - cellular(q * 7.0 + w * 2.0);
      float d = big * 0.62 + heaps * 0.28 + small * 0.1;
      gl_FragColor = vec4(smoothstep(1.0 - uCover - 0.02, 1.0 - uCover + 0.32, d), 0.0, 0.0, 1.0);
    }`,
});
const litMat = new THREE.ShaderMaterial({
  vertexShader: VERT, depthTest: false, depthWrite: false,
  uniforms: { tDens: { value: densRT.texture }, uSun: { value: SUN_DIR } },
  fragmentShader: /* glsl */ `
    uniform sampler2D tDens; uniform vec3 uSun;
    varying vec2 vUv;
    void main() {
      // from mid-layer up to the top along the sun's slant: its drift in the map
      vec2 drift = uSun.xz / max(uSun.y, 0.12) * ${(LAYER / 2 / SPAN).toFixed(6)};
      float d0 = texture2D(tDens, vUv).r, tau = 0.0;
      for (int i = 1; i <= 6; i++) tau += texture2D(tDens, vUv + drift * float(i) / 6.0).r;
      tau = tau / 6.0 * 2.2 + d0 * 1.2;
      gl_FragColor = vec4(d0, exp(-tau * 1.6), 0.0, 1.0);
    }`,
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
quad.frustumCulled = false;
const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const center = new THREE.Vector2(), windBake = new THREE.Vector2(), windNow = new THREE.Vector2();
let time = 0, bakeT = -1e9, litSun = new THREE.Vector3(), needsLit = true;

const material = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  uniforms: {
    tMap: { value: litRT.texture }, tLUT: { value: skyLUT }, uSun: { value: SUN_DIR },
    uSunE: { value: light.sun }, uSkyE: { value: light.sky },
    uCenter: { value: center }, uShift: { value: new THREE.Vector2() },
  },
  vertexShader: /* glsl */ `
    varying vec3 vW;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tMap, tLUT;
    uniform vec3 uSun, uSunE, uSkyE;
    uniform vec2 uCenter, uShift;
    varying vec3 vW;
    ${LUT_GLSL}
    ${NOISE}
    float hg(float mu, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5); }
    void main() {
      vec2 uv = (vW.xz + uShift - uCenter) / ${SPAN.toFixed(1)} + 0.5;
      vec2 m = texture2D(tMap, uv).rg;
      vec3 V = vW - cameraPosition;
      float dist = length(V);
      // ragged edges, finer than the map
      float det = fbm((vW.xz + uShift) / 70.0, 3);
      float dens = clamp((m.r - 0.22 * det * (1.0 - m.r)) / 0.9, 0.0, 1.0);
      if (dens < 0.003) discard;
      float mu = dot(V / dist, uSun);
      // the sun through the cloud: forward scattering toward the sun, a
      // little back; thin edges let it through, the thick of a heap
      // darkens where its light comes from deep inside
      float phase = 0.75 * hg(mu, 0.6) + 0.25 * hg(mu, -0.25);
      float powder = 1.0 - exp(-dens * 5.0);
      vec3 sun = uSunE * m.g * phase * mix(1.0, powder, 0.5) * 0.55;
      // light scattered many times inside: the sun's, seen through the
      // whole heap, softly; and the sky's from above
      vec3 multi = uSunE * pow(m.g, 0.35) * 0.16;
      vec3 sky = uSkyE * (1.0 - 0.3 * dens);
      vec3 col = (sun + multi + sky) * 0.92 / 3.14159;
      // grey bases under thick clouds
      col *= mix(1.0, 0.72, smoothstep(0.4, 1.0, dens));
      // far clouds sink into the haze behind them
      vec3 behind = skyLUT(tLUT, V / dist, uSun);
      col = mix(col, behind, 1.0 - exp(-dist / 12000.0));
      float alpha = (1.0 - exp(-dens * 5.0)) * (1.0 - smoothstep(4000.0, 8500.0, dist));
      gl_FragColor = vec4(col, alpha);
    }`,
});
export const clouds = new THREE.Mesh(new THREE.PlaneGeometry(18000, 18000, 1, 1).rotateX(Math.PI / 2), material);
clouds.position.y = ALT;
clouds.renderOrder = -8;
clouds.frustumCulled = false;
scene.add(clouds);

function draw(m: THREE.ShaderMaterial, rt: THREE.WebGLRenderTarget) {
  quad.material = m;
  renderer.setRenderTarget(rt);
  renderer.render(quad, qCam);
}

/* Each frame: follow the eye, let the wind blow, and re-bake the map
   every 20 s (or when the eye has left its middle), its light when
   the sun has moved. */
export function updateClouds(dt: number, x: number, z: number) {
  time += dt;
  windNow.copy(WIND).multiplyScalar(time);
  clouds.position.x = x; clouds.position.z = z;
  const prev = renderer.getRenderTarget();
  if (time - bakeT > 20 || Math.hypot(x - center.x, z - center.y) > SPAN * 0.15 || densMat.uniforms.uCover!.value !== cloudSettings.cover) {
    bakeT = time;
    center.set(x, z);
    windBake.copy(windNow);
    densMat.uniforms.uCenter!.value.copy(center);
    densMat.uniforms.uWind!.value.copy(windBake);
    densMat.uniforms.uCover!.value = cloudSettings.cover;
    draw(densMat, densRT);
    needsLit = true;
  }
  if (needsLit || litSun.angleTo(SUN_DIR) > 0.005) {
    litSun.copy(SUN_DIR);
    needsLit = false;
    draw(litMat, litRT);
  }
  renderer.setRenderTarget(prev);
  material.uniforms.uShift!.value.copy(windNow).sub(windBake);
}
