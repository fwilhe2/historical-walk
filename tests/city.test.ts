import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { centroid, inside } from '../src/geom/poly';
import { heightAt, setTerrain } from '../src/city/terrain';
import type { City } from '../src/city/types';

/* The generated city (bun run city), checked for what a change to the
   pipeline can silently lose: whole classes of buildings, the
   landmarks, a walkable spawn. The bands are wide on purpose; a
   change that moves a count out of them should be looked at. */
const city = JSON.parse(readFileSync(new URL('../src/cities/potsdam/city.json', import.meta.url), 'utf8')) as City;
const by = (src: string) => city.buildings.filter((b) => b.src === src).length;

describe('Potsdam 1900', () => {
  it('keeps every class of building', () => {
    expect(by('osm')).toBeGreaterThan(1800);
    expect(by('osm')).toBeLessThan(2600);
    expect(by('ohm')).toBeGreaterThan(50);
    expect(by('mtb')).toBeGreaterThan(400);
    expect(by('mtb')).toBeLessThan(1200);
    expect(by('model')).toBeGreaterThan(30);
  });
  it('has its landmarks, each named once', () => {
    for (const n of ['Garnisonkirche', 'St. Nikolaikirche', 'Heilig-Geist-Kirche', 'St. Peter und Paul', 'Stadtschloss', 'Altes Rathaus',
      'Brandenburger Tor', 'Nauener Tor', 'Jägertor', 'Französische Kirche']) {
      expect(city.buildings.filter((b) => b.name === n), n).toHaveLength(1);
    }
  });
  it('has no building of after the year', () => {
    for (const b of city.buildings) if (b.year !== undefined) expect(b.year, b.id).toBeLessThanOrEqual(city.year);
  });
  it('has the Stadtkanal as water, and bridges over it', () => {
    expect(city.areas.some((a) => a.kind === 'water' && a.name === 'Stadtkanal')).toBe(true);
    expect(city.streets.filter((s) => s.kind === 'bridge').length).toBeGreaterThan(10);
  });
  it('spawns you in the open, on a street', () => {
    const { x, z } = city.spawn;
    expect(city.buildings.some((b) => inside(b.outer, x, z))).toBe(false);
    expect(city.streets.some((s) => s.name === 'Brandenburger Straße')).toBe(true);
  });
  it('puts no lantern or tree inside a building', () => {
    const inAny = (x: number, z: number) => city.buildings.some((b) => (b.base ?? 0) < 2 && inside(b.outer, x, z));
    expect(city.lamps.filter((l) => inAny(l.x, l.z))).toHaveLength(0);
    expect(city.trees.filter((t) => inAny(t.x, t.z)).length).toBeLessThan(10);
  });
  it('keeps buildings inside the bounds', () => {
    const [x0, z0, x1, z1] = city.bounds;
    for (const b of city.buildings) {
      const [x, z] = centroid(b.outer);
      expect(x > x0 - 200 && x < x1 + 200 && z > z0 - 200 && z < z1 + 200, b.id).toBe(true);
    }
  });
  it('is level in the town and on the water, with the Brauhausberg standing south of the Havel', () => {
    setTerrain(city.terrain);
    expect(heightAt(city.spawn.x, city.spawn.z)).toBe(0);
    expect(heightAt(30, -60)).toBe(0);                 // Alter Markt
    for (const a of city.areas.filter((a) => a.kind === 'water').slice(0, 20)) {
      const [x, z] = centroid(a.outer);
      if (inside(a.outer, x, z)) expect(heightAt(x, z)).toBe(0);
    }
    // Brauhausberg, 52.3895 N 13.0640 E: some 20 m and more above the town
    let top = 0;
    for (let x = 100; x < 450; x += 10) for (let z = 500; z < 900; z += 10) top = Math.max(top, heightAt(x, z));
    expect(top).toBeGreaterThan(20);
  });
});
