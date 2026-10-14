import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeTour, nearestNode, shortestPath, streetGraph } from '../src/app/tour';
import type { City } from '../src/city/types';

const city = JSON.parse(readFileSync(new URL('../src/cities/potsdam/city.json', import.meta.url), 'utf8')) as City;

describe('the tour', () => {
  const g = streetGraph(city);
  it('finds every described landmark from the spawn along the streets', () => {
    const from = nearestNode(g, city.spawn.x, city.spawn.z);
    const missing: string[] = [];
    for (const l of city.labels.filter((l) => l.about)) {
      const p = shortestPath(g, from, nearestNode(g, l.x, l.z));
      if (!p) missing.push(l.text);
    }
    expect(missing).toEqual([]);
  });
  it('walks a path no longer than twice the crow-flies distance through the grid', () => {
    const a = nearestNode(g, city.spawn.x, city.spawn.z), b = nearestNode(g, 30, -60);   // to the Alter Markt
    const p = shortestPath(g, a, b)!;
    let L = 0;
    for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!);
    const crow = Math.hypot(p[p.length - 2]! - p[0]!, p[p.length - 1]! - p[1]!);
    expect(L).toBeLessThan(crow * 2);
  });
  it('steers the walker toward its first stop', () => {
    const w = { x: city.spawn.x, z: city.spawn.z, yaw: 0, pitch: 0, fly: false, auto: null as { vx: number; vz: number } | null };
    const t = makeTour(city);
    expect(t.start(w)).toBe(true);
    const target = t.target!;
    const d0 = Math.hypot(target.x - w.x, target.z - w.z);
    for (let i = 0; i < 600; i++) { t.step(1 / 30, w); if (w.auto) { w.x += w.auto.vx / 30; w.z += w.auto.vz / 30; } }
    expect(Math.hypot(target.x - w.x, target.z - w.z)).toBeLessThan(d0);
  });
});
