import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { buildBuildings, nightLight, sourceView } from './city/buildings';
import { buildGround } from './city/ground';
import { buildColumns, buildLamps, buildRails, buildTrees, buildWalls, buildWoods, lampGlow } from './city/props';
import { buildWater, waterTime } from './city/water';
import { buildTraffic } from './city/traffic';
import { buildPeople } from './city/people';
import { setTerrain } from './city/terrain';
import type { City } from './city/types';
import { buildSegs } from './player/collide';
import { stepWalker, walker } from './player/walker';
import { camera, pitchObj, renderer, scene, yawObj } from './render/renderer';
import { SUN_DIR, cloudTime, clouds, hemi, placeShadow, sky, sun, sunState, updateSun } from './render/sky';
import { hud, note } from './ui/hud';
import { historicMap } from './ui/map';
import { sound } from './audio/sound';
import { parseView, viewHash } from './app/view';

/* ── Boot ───────────────────────────────────────────────────────
   Load the city, build its meshes, place the walker, run. */
const bootN = document.getElementById('boot-n')!;
// The city: ?city=<id>, one of src/cities/*/city.json (built by tools/build-city.ts).
const CITY_FILES = import.meta.glob<{ default: unknown }>('./cities/*/city.json');
const cityId = new URLSearchParams(location.search).get('city') ?? 'potsdam';
const load = CITY_FILES[`./cities/${cityId}/city.json`] ?? CITY_FILES['./cities/potsdam/city.json']!;
const city = (await load()).default as City;
const LAT = city.origin[0];
bootN.textContent = `${city.buildings.length} buildings, ${city.streets.length} streets`;
await new Promise((r) => setTimeout(r, 0));

setTerrain(city.terrain);
const ground = buildGround(city);
scene.add(ground.mesh);
scene.add(buildWater(city, ground));
scene.add(buildBuildings(city.buildings));
scene.add(buildTrees(city));
scene.add(buildWoods(city));
scene.add(buildWalls(city));
scene.add(buildColumns(city));
scene.add(buildLamps(city));
scene.add(buildRails(city));
const traffic = buildTraffic(city);
scene.add(traffic.group);
const people = buildPeople(city);
scene.add(people.group);
const segs = buildSegs(city);
// The sky through the environment map is the ambient light: about
// a fifth of the sun's on a clear afternoon, which 0.7 gives here.
scene.traverse((o) => {
  const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
  if (m && 'envMapIntensity' in m && m.roughness > 0.3) m.envMapIntensity = 0.7;
});

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
overlay.addEventListener('click', () => { overlay.classList.add('hidden'); sound.unlock(); if (!matchMedia('(pointer: coarse)').matches) lock(); });
renderer.domElement.addEventListener('click', lock);
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && !probe && !matchMedia('(pointer: coarse)').matches) overlay.classList.remove('hidden');
});
document.getElementById('credits')!.textContent = city.credits.join(' · ');
addEventListener('keydown', (e) => {
  if (e.repeat && e.code !== 'BracketLeft' && e.code !== 'BracketRight') return;
  if (e.code === 'KeyF') { walker.fly = !walker.fly; if (walker.fly) walker.flyY = Math.max(walker.flyY, 40); note(walker.fly ? 'FLYING' : 'WALKING'); }
  if (e.code === 'KeyH') hud.toggleClean();
  if (e.code === 'KeyM') historicMap.toggle();
  if (e.code === 'KeyV') {
    sourceView.value = 1 - sourceView.value;
    note(sourceView.value ? 'GREEN STANDS TODAY · BLUE LOST (OHM) · ORANGE REBUILT FROM THE 1903 MAP · VIOLET MODELLED' : 'SOURCES OFF');
  }
  if (e.code === 'KeyN') note(sound.toggleMute() ? 'SOUND OFF' : 'SOUND ON');
  if (e.code === 'BracketRight') sunState.hour = Math.min(21.5, sunState.hour + 0.25);
  if (e.code === 'BracketLeft') sunState.hour = Math.max(4, sunState.hour - 0.25);
  if (e.code === 'KeyG') {
    const l = hud.nextLandmark();
    if (l) { walker.x = l.x; walker.z = l.z; walker.yaw = l.yaw; walker.pitch = 0.15; walker.fly = false; note(l.text); }
  }
});

/* ── Probe: a handle for tools/shot.ts ─────────────────────────── */
const probe = new URLSearchParams(location.search).has('probe');
const frameWaiters: (() => void)[] = [];

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
      hud.refresh();
      await this.frames(3);
    },
    state() {
      return JSON.stringify({ people: people.people.map((_, i) => people.where(i)).map(([x, z]) => [Math.round(x), Math.round(z), Math.round(Math.hypot(x - walker.x, z - walker.z))]).sort((a, b) => a[2]! - b[2]!).slice(0, 3), cars: traffic.cars.map((c) => [Math.round(c.obj.position.x), Math.round(c.obj.position.z), Math.round(c.obj.rotation.y * 57.3)]), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, sun: sun.intensity, dir: SUN_DIR.toArray(), hemi: hemi.intensity, env: !!scene.environment, hour: sunState.hour, tone: renderer.toneMapping, exp: renderer.toneMappingExposure });
    },
    frames(n: number) { return new Promise<void>((ok) => { let k = n; const f = () => (--k <= 0 ? ok() : frameWaiters.push(f)); frameWaiters.push(f); }); },
  };
}

/* ── Lamplight ───────────────────────────────────────────────────────
   The eight lanterns nearest you light the ground for real (point
   lights, re-chosen as you walk); the rest only glow. */
const lampLights = Array.from({ length: 8 }, () => {
  const l = new THREE.PointLight(0xffb060, 0, 22, 2);
  scene.add(l);
  return l;
});
let lampT = 0;
function placeLampLights(glow: number) {
  for (const l of lampLights) l.intensity = glow * 40;
  if (glow <= 0 || (lampT -= 1 / 60) > 0) return;
  lampT = 0.5;
  const near = city.lamps.map((l) => ({ l, d: (l.x - walker.x) ** 2 + (l.z - walker.z) ** 2 })).sort((a, b) => a.d - b.d).slice(0, lampLights.length);
  near.forEach((n, i) => lampLights[i]!.position.set(n.l.x, 3.4, n.l.z));
}

/* ── Sound's view of the town ──────────────────────────────────────
   Steps as the walker lands them; birds by the trees within 35 m
   (counted once a second); bells from the towers: the hours from the
   Garnisonkirche, the quarters from St. Nikolai. Time runs at the
   clock's own pace, so a long walk hears them. */
const towers = Object.fromEntries(city.labels.filter((l) => l.kind === 'landmark').map((l) => [l.text, l]));
let hoofT = 0, lastSteps = 0, treeT = 0, nearTrees = 0, lastQuarter = Math.floor(sunState.hour * 4);
function stepSound(dt: number) {
  if (walker.steps !== lastSteps) {
    lastSteps = walker.steps;
    if (!walker.fly) sound.step(ground.surface(walker.x, walker.z), Math.hypot(walker.vx, walker.vz));
  }
  if ((treeT -= dt) <= 0) {
    treeT = 1;
    nearTrees = 0;
    for (const t of city.trees) if ((t.x - walker.x) ** 2 + (t.z - walker.z) ** 2 < 35 * 35) nearTrees++;
  }
  // hoofbeats of the nearest moving tram horse, four to a stride
  let hd = Infinity;
  for (const c of traffic.cars) if (c.wait <= 0) hd = Math.min(hd, Math.hypot(c.obj.position.x - walker.x, c.obj.position.z - walker.z));
  if (hd < 80 && (hoofT -= dt) <= 0) { hoofT = 0.18 + Math.random() * 0.06; sound.hoof(hd); }
  const surf = ground.surface(walker.x, walker.z);
  sound.update(dt, nearTrees, surf === 'setts' || surf === 'slabs');
  const q = Math.floor(sunState.hour * 4);
  if (q !== lastQuarter) {
    lastQuarter = q;
    const dist = (name: string) => { const l = towers[name]; return l ? Math.hypot(l.x - walker.x, l.z - walker.z) : 600; };
    const { hours, quarters } = city.bells;
    if (q % 4 === 0) { if (hours) sound.bell(Math.floor(sunState.hour) % 12 || 12, dist(hours), 196); }
    else if (quarters) sound.bell(q % 4, dist(quarters), 330);
  }
}

/* ── Loop ───────────────────────────────────────────────────────── */
document.getElementById('boot')!.hidden = true;
hud.show(city);
historicMap.init(city);
const clock = new THREE.Clock();
let hashT = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  stepWalker(dt, segs, ground, 0.0022);
  if (!probe) sunState.hour = (sunState.hour + dt / 3600) % 24;
  stepSound(dt);
  yawObj.position.set(walker.x + Math.cos(walker.yaw) * walker.sway, walker.y, walker.z - Math.sin(walker.yaw) * walker.sway);
  yawObj.rotation.y = walker.yaw;
  pitchObj.rotation.x = walker.pitch;
  const alt = updateSun(LAT);
  // the lamplighter comes round as the sun goes down
  lampGlow.value = THREE.MathUtils.smoothstep(-alt, -0.05, 0.08);
  nightLight.value = THREE.MathUtils.smoothstep(-alt, -0.02, 0.12);
  placeLampLights(lampGlow.value);
  updateEnv();
  placeShadow(walker.x, 0, walker.z);
  waterTime.value += dt;
  traffic.step(dt);
  people.step(dt, walker.x, walker.z, nightLight.value);
  cloudTime.value += dt;
  clouds.position.x = walker.x; clouds.position.z = walker.z;
  hud.update(dt, walker, sunState.hour, ground);
  historicMap.draw(walker.x, walker.z, walker.yaw);
  if ((hashT += dt) > 1 && !probe) {
    hashT = 0;
    history.replaceState(null, '', viewHash(walker, sunState.hour));
  }
  renderer.render(scene, camera);
  const w = frameWaiters.splice(0);
  for (const f of w) f();
});
