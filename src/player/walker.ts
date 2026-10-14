import { keys, look } from './input';
import { pushOut, type Segs } from './collide';
import type { Ground } from '../city/ground';
import { heightAt } from '../city/terrain';

/* ── The walker ─────────────────────────────────────────────────
   A pedestrian of 1900: 1.4 m/s at a stroll, about 2.2 at a brisk
   walk (Shift), eye at 1.62 m. Speed eases in and out over a few
   tenths of a second, the head rises and falls a couple of
   centimetres with each step and sways a little sideways, and the
   feet keep out of the walls (collide.ts) and out of the water.
   Free flight (F) lifts you above the roofs to look over the town;
   it ignores walls. */
export const EYE = 1.62;
const WALK = 1.4, BRISK = 2.3, FLY = 14, R = 0.3;

export const walker = {
  x: 0, z: 0, y: EYE, yaw: 0, pitch: 0,
  vx: 0, vz: 0,
  fly: false, flyY: 40,
  phase: 0,      // step cycle, radians; a step every π
  steps: 0,      // steps taken, for footstep sounds
  bob: 0, sway: 0,
};

export function stepWalker(dt: number, segs: Segs, ground: Ground, sens: number) {
  const w = walker;
  w.yaw -= look.dx * sens; w.pitch -= look.dy * sens;
  look.dx = look.dy = 0;
  w.pitch = Math.max(-1.45, Math.min(1.45, w.pitch));
  const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const kz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  const len = Math.hypot(kx, kz) || 1;
  // yaw 0 looks north (−z); positive yaw turns left (toward −x)
  const s = Math.sin(w.yaw), c = Math.cos(w.yaw);
  const ix = (kx * c + kz * s) / len, iz = (-kx * s + kz * c) / len;
  if (w.fly) {
    const v = FLY * (keys.ShiftLeft || keys.ShiftRight ? 3 : 1);
    w.x += ix * v * dt; w.z += iz * v * dt;
    if (keys.Space) w.flyY += v * dt;
    if (keys.KeyC || keys.ControlLeft) w.flyY = Math.max(EYE, w.flyY - v * dt);
    w.y += (Math.max(w.flyY, heightAt(w.x, w.z) + EYE) - w.y) * Math.min(1, dt * 4);
    w.vx = w.vz = 0;
    return;
  }
  const vmax = keys.ShiftLeft || keys.ShiftRight ? BRISK : WALK;
  const tx = ix * vmax * (kx || kz ? 1 : 0), tz = iz * vmax * (kx || kz ? 1 : 0);
  const a = Math.min(1, dt * ((kx || kz) ? 5 : 7));
  w.vx += (tx - w.vx) * a; w.vz += (tz - w.vz) * a;
  let nx = w.x + w.vx * dt, nz = w.z + w.vz * dt;
  // Water stops you at the quay: try each axis on its own, so you
  // slide along the edge rather than stick.
  if (ground.isWater(nx, nz)) {
    if (!ground.isWater(nx, w.z)) nz = w.z;
    else if (!ground.isWater(w.x, nz)) nx = w.x;
    else { nx = w.x; nz = w.z; }
  }
  [nx, nz] = pushOut(segs, nx, nz, R);
  const moved = Math.hypot(nx - w.x, nz - w.z);
  w.x = nx; w.z = nz;
  // Head motion: a vault over each foot, about 2 cm, and a sway of
  // 1.5 cm toward the standing foot. Step length 0.7 m at a stroll.
  const sp = moved / Math.max(dt, 1e-4);
  const stepLen = 0.62 + 0.12 * Math.min(1, sp / BRISK);
  const prev = w.phase;
  w.phase += moved / stepLen * Math.PI;
  if (Math.floor(w.phase / Math.PI) !== Math.floor(prev / Math.PI)) w.steps++;
  const amt = Math.min(1, sp / WALK);
  w.bob = -Math.abs(Math.sin(w.phase)) * 0.022 * amt + 0.011 * amt;
  w.sway = Math.sin(w.phase) * 0.015 * amt;
  w.y += (EYE + heightAt(w.x, w.z) + w.bob - w.y) * Math.min(1, dt * 12);
  w.flyY = Math.max(w.flyY, 40);
}
