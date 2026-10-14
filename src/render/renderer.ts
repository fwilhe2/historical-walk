import * as THREE from 'three';

/* ═════════════════════════════════════════════════════════════
   RENDERER
   ═════════════════════════════════════════════════════════════ */
export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// AgX: a gentle toe and film-like highlights, so a sunlit facade and
// the street in its shadow both keep their detail.
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
export const ANISO = renderer.capabilities.getMaxAnisotropy();
renderer.domElement.id = 'view';
document.body.prepend(renderer.domElement);

export const scene = new THREE.Scene();

export const FOV0 = 70;   // vertical, degrees
export const camera = new THREE.PerspectiveCamera(FOV0, innerWidth / innerHeight, 0.1, 6000);
// Yaw on the outer object, pitch on the inner: the camera never rolls.
export const yawObj = new THREE.Object3D();
export const pitchObj = new THREE.Object3D();
yawObj.add(pitchObj); pitchObj.add(camera); scene.add(yawObj);

export function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
