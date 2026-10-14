/* ── Terrain ────────────────────────────────────────────────────
   The ground's height above the town's level (tools/build-city.ts),
   bilinear on a 20 m grid. Pure: the ground mesh, everything that
   stands on the ground and the walker all ask heightAt(), so they
   agree. Zero (level) in the town, on the water and off the grid. */
import type { City } from './types';

let grid: { x0: number; z0: number; step: number; nx: number; nz: number; h: Int16Array } | null = null;

export function setTerrain(t: City['terrain']) {
  if (!t) { grid = null; return; }
  const bin = atob(t.dm);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  grid = { ...t, h: new Int16Array(bytes.buffer) };
}

export function heightAt(x: number, z: number): number {
  if (!grid) return 0;
  const { x0, z0, step, nx, nz, h } = grid;
  const fx = (x - x0) / step, fz = (z - z0) / step;
  if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return 0;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * nx + i;
  return ((h[k]! * (1 - u) + h[k + 1]! * u) * (1 - v) + (h[k + nx]! * (1 - u) + h[k + nx + 1]! * u) * v) / 10;
}
