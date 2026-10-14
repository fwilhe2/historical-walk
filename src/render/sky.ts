import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { scene } from './renderer';

/* ── Sky, sun and haze ──────────────────────────────────────────
   Preetham's daylight sky (three's Sky) for the dome, a sun whose
   direction drives both the dome and the key light, a hemisphere
   light for the sky's own fill, and exponential fog the colour of
   the horizon for the haze a coal-heated town of 1900 had in its air.

   The sun is set by time of day on a date: by default a late
   afternoon in early summer (Potsdam, 52.4° N). */
export const sky = new Sky();
sky.scale.setScalar(5000);
scene.add(sky);
const su = sky.material.uniforms;
su.turbidity!.value = 4.5;
su.rayleigh!.value = 1.4;
su.mieCoefficient!.value = 0.006;
su.mieDirectionalG!.value = 0.82;

export const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const S = 110;
Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 900 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
export const hemi = new THREE.HemisphereLight(0xfff0dc, 0xb59a78, 0.3);
scene.add(hemi);
scene.fog = new THREE.FogExp2(0xc9d3dc, 0.00065);

/* Stars for the night: points on a far sphere, fading in as the sky
   darkens below civil twilight. */
export const stars = (() => {
  const n = 2500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pos.set([r * Math.cos(a) * 4000, Math.abs(z) * 4000 + 60, r * Math.sin(a) * 4000], i * 3);
    const b = Math.pow(rnd(), 3) * 0.9 + 0.1;
    col.set([b, b, b * (0.9 + rnd() * 0.2)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const p = new THREE.Points(g, m);
  p.renderOrder = -1;
  scene.add(p);
  return p;
})();

export const SUN_DIR = new THREE.Vector3();
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

export function updateSun(lat: number) {
  const { alt } = sunDirection(sunState.hour, sunState.day, lat, SUN_DIR);
  su.sunPosition!.value.copy(SUN_DIR);
  const e = Math.max(0, Math.sin(alt));
  // Light falls off and reddens toward the horizon; below it, dusk.
  const day = THREE.MathUtils.smoothstep(alt, -0.1, 0.12);
  sun.intensity = 4.2 * THREE.MathUtils.smoothstep(alt, -0.02, 0.2);
  sun.color.setRGB(1, 0.78 + 0.2 * Math.min(1, e * 2.2), 0.6 + 0.36 * Math.min(1, e * 2));
  // The sky's own light comes from the environment map (main.ts); the
  // hemisphere only adds the warm bounce off sunlit streets and walls.
  hemi.intensity = 0.05 + 0.3 * day * Math.min(1, e * 3);
  (stars.material as THREE.PointsMaterial).opacity = THREE.MathUtils.smoothstep(-alt, 0.06, 0.2);
  const fog = scene.fog as THREE.FogExp2;
  fog.color.setRGB(0.78, 0.82, 0.86).lerp(new THREE.Color(0.95, 0.72, 0.55), Math.max(0, 1 - e * 4) * day * 0.5).multiplyScalar(0.03 + 0.97 * day);
  return alt;
}

// Keep the shadow camera on the player, snapped to its texels so
// shadow edges do not crawl as you walk.
const _rx = new THREE.Vector3(), _ry = new THREE.Vector3(), _t = new THREE.Vector3();
export function placeShadow(x: number, y: number, z: number) {
  const cam = sun.shadow.camera;
  const texel = (cam.right - cam.left) / sun.shadow.mapSize.x;
  _rx.set(0, 1, 0).cross(SUN_DIR).normalize();
  _ry.copy(SUN_DIR).cross(_rx);
  _t.set(x, y, z);
  const ex = _t.dot(_rx), ey = _t.dot(_ry);
  _t.addScaledVector(_rx, Math.round(ex / texel) * texel - ex).addScaledVector(_ry, Math.round(ey / texel) * texel - ey);
  sun.target.position.copy(_t);
  sun.position.copy(_t).addScaledVector(SUN_DIR, 450);
}
