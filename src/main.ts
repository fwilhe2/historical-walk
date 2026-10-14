import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { buildBuildings } from './city/buildings';
import { buildGround } from './city/ground';
import { buildTrees, buildWalls } from './city/props';
import { buildWater, waterTime } from './city/water';
import type { City } from './city/types';
import { buildSegs } from './player/collide';
import { stepWalker, walker } from './player/walker';
import { camera, pitchObj, renderer, scene, yawObj } from './render/renderer';
import { SUN_DIR, placeShadow, sky, sunState, updateSun } from './render/sky';
import { hud, note } from './ui/hud';
import { parseView, viewHash } from './app/view';

/* ── Boot ───────────────────────────────────────────────────────
   Load the city, build its meshes, place the walker, run. */
const bootN = document.getElementById('boot-n')!;
const city = (await import('./cities/potsdam/city.json')).default as unknown as City;
const LAT = city.origin[0];
bootN.textContent = `${city.buildings.length} buildings, ${city.streets.length} streets`;
await new Promise((r) => setTimeout(r, 0));

const ground = buildGround(city);
scene.add(ground.mesh);
scene.add(buildWater(city, ground));
scene.add(buildBuildings(city.buildings));
scene.add(buildTrees(city));
scene.add(buildWalls(city));
const segs = buildSegs(city);

// Reflections: the sky alone, prefiltered for the standard materials,
// rebuilt when the sun has moved far enough to show.
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = new Sky();
envSky.scale.setScalar(1000);
envScene.add(envSky);
let envRT: THREE.WebGLRenderTarget | null = null, envHour = NaN;
function updateEnv() {
  if (Math.abs(envHour - sunState.hour) < 0.25) return;
  envHour = sunState.hour;
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) envSky.material.uniforms[k]!.value = sky.material.uniforms[k]!.value;
  envSky.material.uniforms.sunPosition!.value.copy(SUN_DIR);
  envRT?.dispose();
  envRT = pmrem.fromScene(envScene, 0, 0.1, 2000);
  scene.environment = envRT.texture;
}

const start = parseView(location.hash);
walker.x = start?.x ?? city.spawn.x;
walker.z = start?.z ?? city.spawn.z;
walker.yaw = start?.yaw ?? city.spawn.yaw;
walker.pitch = start?.pitch ?? 0;
if (start?.t !== undefined) sunState.hour = start.t;
if (start?.y !== undefined) { walker.fly = true; walker.flyY = walker.y = start.y; }

/* ── Controls that act once ─────────────────────────────────────── */
const overlay = document.getElementById('overlay')!;
const lock = () => renderer.domElement.requestPointerLock();
overlay.addEventListener('click', () => { overlay.classList.add('hidden'); lock(); });
renderer.domElement.addEventListener('click', lock);
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && !probe) overlay.classList.remove('hidden');
});
document.getElementById('credits')!.textContent = city.credits.join(' · ');
addEventListener('keydown', (e) => {
  if (e.repeat && e.code !== 'BracketLeft' && e.code !== 'BracketRight') return;
  if (e.code === 'KeyF') { walker.fly = !walker.fly; if (walker.fly) walker.flyY = Math.max(walker.flyY, 40); note(walker.fly ? 'FLYING' : 'WALKING'); }
  if (e.code === 'KeyH') hud.toggleClean();
  if (e.code === 'BracketRight') sunState.hour = Math.min(21.5, sunState.hour + 0.25);
  if (e.code === 'BracketLeft') sunState.hour = Math.max(4, sunState.hour - 0.25);
  if (e.code === 'KeyG') {
    const l = hud.nextLandmark(walker.x, walker.z);
    if (l) { walker.x = l.x; walker.z = l.z; note(l.text); }
  }
});

/* ── Probe: a handle for tools/shot.ts ─────────────────────────── */
const probe = new URLSearchParams(location.search).has('probe');
const frameWaiters: (() => void)[] = [];
declare global { interface Window { hw?: { go(hash: string): Promise<void>; frames(n: number): Promise<void> } } }
if (probe) {
  overlay.classList.add('hidden');
  window.hw = {
    async go(hash: string) {
      const v = parseView(hash);
      if (!v) return;
      walker.x = v.x; walker.z = v.z; walker.yaw = v.yaw; walker.pitch = v.pitch;
      if (v.t !== undefined) sunState.hour = v.t;
      walker.fly = v.y !== undefined;
      if (v.y !== undefined) walker.flyY = walker.y = v.y;
      await this.frames(3);
    },
    frames(n: number) { return new Promise<void>((ok) => { let k = n; const f = () => (--k <= 0 ? ok() : frameWaiters.push(f)); frameWaiters.push(f); }); },
  };
}

/* ── Loop ───────────────────────────────────────────────────────── */
document.getElementById('boot')!.hidden = true;
hud.show(city);
const clock = new THREE.Clock();
let hashT = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  stepWalker(dt, segs, ground, 0.0022);
  yawObj.position.set(walker.x + Math.cos(walker.yaw) * walker.sway, walker.y, walker.z - Math.sin(walker.yaw) * walker.sway);
  yawObj.rotation.y = walker.yaw;
  pitchObj.rotation.x = walker.pitch;
  updateSun(LAT);
  updateEnv();
  placeShadow(walker.x, 0, walker.z);
  waterTime.value += dt;
  hud.update(dt, walker, sunState.hour, ground);
  if ((hashT += dt) > 1 && !probe) {
    hashT = 0;
    history.replaceState(null, '', viewHash(walker, sunState.hour));
  }
  renderer.render(scene, camera);
  const w = frameWaiters.splice(0);
  for (const f of w) f();
});
