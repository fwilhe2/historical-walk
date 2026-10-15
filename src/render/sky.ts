import * as THREE from 'three';
import { renderer, scene } from './renderer';
import { ATMO, ATMO_GLSL, LUT_GLSL, lightAt, type RGB } from './atmo';

/* ── Sky, sun and haze ──────────────────────────────────────────
   The sky comes from a physical model of the atmosphere (atmo.ts),
   rendered into a small sky-view lookup table whenever the sun has
   moved enough to show; the dome, the clouds, the haze over distant
   things (render/post.ts) and the environment map all read it, so
   they agree. The same model gives the sun's colour and strength
   where you stand (red and weak through the haze at sunset), the
   sky's light on the ground, and from those the camera's exposure.

   The sun is set by time of day on a date: by default a late
   afternoon in early summer (Potsdam, 52.4° N). Everything here is
   in linear HDR units; post.ts exposes and tone-maps. */

/* ── The lookup table ─────────────────────────────────────────── */
const LUT_W = 192, LUT_H = 108;
const lutRT = new THREE.WebGLRenderTarget(LUT_W, LUT_H, {
  type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
});
lutRT.texture.wrapS = lutRT.texture.wrapT = THREE.ClampToEdgeWrapping;
export const skyLUT = lutRT.texture;

const FS_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const lutMat = new THREE.ShaderMaterial({
  uniforms: { uSunL: { value: new THREE.Vector3() }, uH: { value: 30 }, uSkyE: { value: new THREE.Vector3() } },
  vertexShader: FS_VERT,
  fragmentShader: /* glsl */ `
    uniform vec3 uSunL, uSkyE; uniform float uH;
    varying vec2 vUv;
    ${ATMO_GLSL}
    void main() {
      // texel centres: u the azimuth from the sun, v the packed elevation
      float az = vUv.x * A_PI;
      float v = vUv.y * 2.0 - 1.0;
      float el = sign(v) * v * v * A_PI * 0.5;
      vec3 d = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
      gl_FragColor = vec4(aSky(uH, d, uSunL, uSkyE), 1.0);
    }`,
  depthTest: false, depthWrite: false,
});
const fsTri = new THREE.BufferGeometry();
fsTri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
fsTri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const lutQuad = new THREE.Mesh(fsTri, lutMat);
lutQuad.frustumCulled = false;
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/* ── The dome ─────────────────────────────────────────────────────
   A sphere round the eye, drawn first and without depth, so the post
   pass knows sky pixels by their cleared depth. It adds the sun's
   disc (0.27° across its radius, darker at the limb) and a faint
   night sky. */
export const SUN_DIR = new THREE.Vector3(0, 1, 0);
const sunDisc = new THREE.Vector3();   // radiance of the disc's centre
const NIGHT = new THREE.Vector3(0.0009, 0.0013, 0.0024);
function skyMaterial(disc: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: { tLUT: { value: skyLUT }, uSun: { value: SUN_DIR }, uDisc: { value: sunDisc }, uNight: { value: NIGHT } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vDir = w.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * w;
        gl_Position.z = gl_Position.w * 0.99999;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tLUT; uniform vec3 uSun, uDisc, uNight;
      varying vec3 vDir;
      ${LUT_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 L = skyLUT(tLUT, d, uSun);
        // the night: airglow and starlight, fading below the horizon
        L += uNight * smoothstep(-0.2, 0.15, d.y);
        ${disc ? `
        float r = length(d - uSun) / 0.00465;
        float w = fwidth(r) + 1e-4;
        float inDisc = 1.0 - smoothstep(1.0 - w, 1.0 + w, r);
        L += uDisc * inDisc * (0.45 + 0.55 * sqrt(max(0.0, 1.0 - r * r)));` : ''}
        gl_FragColor = vec4(L, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
}
export const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), skyMaterial(true));
sky.renderOrder = -10;
sky.frustumCulled = false;
sky.onBeforeRender = (_r, _s, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };
scene.add(sky);

/* ── Lights ───────────────────────────────────────────────────────
   The sun, with one shadow map 300 m across. Most of it lies ahead of
   you: the box is pushed along the way you look, so its texels go to
   what you can see. (A second, coarse map for the far town cost a
   third of the frame rate on an Intel GPU even unused, so there is
   none; beyond the box the haze and the walls' own shading carry it.) */
export const sun = new THREE.DirectionalLight(0xffffff, ATMO.sunE);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const S = 150;
Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 1400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

/* What the light comes to where you stand: the sun's irradiance (rgb),
   the sky's on level ground, and the exposure a camera would choose
   for them. Read by the clouds, the post pass and the HUD probe. */
export const light = {
  sun: new THREE.Vector3(), sky: new THREE.Vector3(), ground: 1,
  exposure: 1,
};

/* Stars for the night: points on a far sphere, fading in as the sky
   darkens below civil twilight. */
export const stars = (() => {
  const n = 2500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pos.set([r * Math.cos(a) * 3500, Math.abs(z) * 3500 + 60, r * Math.sin(a) * 3500], i * 3);
    const b = (Math.pow(rnd(), 3) * 0.9 + 0.1) * 0.03;
    col.set([b, b, b * (0.9 + rnd() * 0.2)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const p = new THREE.Points(g, m);
  p.renderOrder = -9;
  p.frustumCulled = false;
  p.onBeforeRender = (_r, _s, cam) => { p.position.copy(cam.position); p.updateMatrixWorld(); };
  scene.add(p);
  return p;
})();

export const sunState = { hour: 17.5, day: 172 };   // day of year (21 June)

/* Solar position for latitude φ: declination from the day, hour angle
   from local solar time. Accurate to a degree, which is plenty. */
export function sunDirection(hour: number, day: number, latDeg: number, out: THREE.Vector3) {
  const φ = latDeg * Math.PI / 180;
  const δ = -23.44 * Math.PI / 180 * Math.cos(2 * Math.PI * (day + 10) / 365);
  const H = (hour - 12) * 15 * Math.PI / 180;
  const sinAlt = Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  // Azimuth from north, clockwise (east = 90°).
  const cosAz = (Math.sin(δ) - Math.sin(alt) * Math.sin(φ)) / (Math.cos(alt) * Math.cos(φ));
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  if (H > 0) az = 2 * Math.PI - az;
  // World: x east, −z north, y up.
  out.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
  return { alt, az };
}

/* ── Keeping it current ───────────────────────────────────────────
   The table depends only on the sun's altitude (it is laid out
   relative to the sun's azimuth) and a little on the eye's height;
   it is redrawn when either has moved enough to show, the light
   and exposure with it, and the environment map less often. */
let lutAlt = NaN, lutH = NaN, envAlt = NaN;
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), skyMaterial(false)));
let envRT: THREE.WebGLRenderTarget | null = null;
const SUN_SOLID = 2 * Math.PI * (1 - Math.cos(0.00465));
// Exposure: what a photographer would set for the light on the ground,
// but only partly following it into the dusk, which should look dusky.
const E_DAY = 4.6, EXP_DAY = 1.0;

function refresh(alt: number, eyeH: number) {
  const l = lightAt(alt, eyeH);
  light.sun.set(...(l.sun as RGB));
  light.sky.set(...(l.sky as RGB));
  light.ground = l.ground[1];
  light.exposure = EXP_DAY * Math.min(14, Math.pow(E_DAY / Math.max(1e-6, l.ground[1]), 0.55));
  const peak = Math.max(l.sun[0], l.sun[1], l.sun[2]);
  sun.intensity = peak;
  if (peak > 0) sun.color.setRGB(l.sun[0] / peak, l.sun[1] / peak, l.sun[2] / peak);
  // the disc: the sun's irradiance spread over its solid angle, held
  // to what half floats (and the bloom) can take
  const k = Math.min(1, 3000 / Math.max(1e-6, peak / SUN_SOLID));
  sunDisc.set(l.sun[0] / SUN_SOLID * k, l.sun[1] / SUN_SOLID * k, l.sun[2] / SUN_SOLID * k);
  const u = lutMat.uniforms;
  u.uSunL!.value.set(Math.cos(alt), Math.sin(alt), 0);
  u.uH!.value = eyeH;
  u.uSkyE!.value.copy(light.sky);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(lutRT);
  renderer.render(lutQuad, fsCam);
  renderer.setRenderTarget(prev);
}

function updateEnv() {
  envRT?.dispose();
  envRT = pmrem.fromScene(envScene, 0, 0.1, 1000);
  scene.environment = envRT.texture;
}

export function updateSun(lat: number, eyeY = 2) {
  const { alt } = sunDirection(sunState.hour, sunState.day, lat, SUN_DIR);
  const eyeH = 30 + Math.max(0, eyeY);
  if (!(Math.abs(alt - lutAlt) < 0.0015) || !(Math.abs(eyeH - lutH) < 40)) {
    lutAlt = alt; lutH = eyeH;
    refresh(alt, eyeH);
  }
  if (!(Math.abs(alt - envAlt) < 0.01)) { envAlt = alt; updateEnv(); }
  (stars.material as THREE.PointsMaterial).opacity = THREE.MathUtils.smoothstep(-alt, 0.06, 0.2);
  return alt;
}

// Keep the shadow camera ahead of the eye (fx, fz: the way you look,
// level), snapped to its texels so shadow edges do not crawl as you
// walk or turn.
const _rx = new THREE.Vector3(), _ry = new THREE.Vector3(), _t = new THREE.Vector3();
export function placeShadow(x: number, y: number, z: number, fx = 0, fz = 0) {
  const cam = sun.shadow.camera;
  const ahead = (cam.right - cam.left) * 0.38;
  const texel = (cam.right - cam.left) / sun.shadow.mapSize.x;
  _rx.set(0, 1, 0).cross(SUN_DIR).normalize();
  _ry.copy(SUN_DIR).cross(_rx);
  _t.set(x + fx * ahead, y, z + fz * ahead);
  const ex = _t.dot(_rx), ey = _t.dot(_ry);
  _t.addScaledVector(_rx, Math.round(ex / texel) * texel - ex).addScaledVector(_ry, Math.round(ey / texel) * texel - ey);
  sun.target.position.copy(_t);
  sun.position.copy(_t).addScaledVector(SUN_DIR, 700);
}
