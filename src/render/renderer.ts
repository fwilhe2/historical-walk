import * as THREE from 'three';

/* ═════════════════════════════════════════════════════════════
   RENDERER
   ═════════════════════════════════════════════════════════════ */
// No antialiasing on the canvas: the scene renders into a multisampled
// HDR target, and post.ts exposes, tone-maps and writes the screen.
export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
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
