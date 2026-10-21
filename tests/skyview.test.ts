import { describe, expect, it } from 'vitest';
import { groundSkyAt, heightField, wallSky } from '../src/city/skyview';
import type { Building } from '../src/city/types';

const block = (id: string, x0: number, z0: number, x1: number, z1: number, eave = 12): Building => ({
  id, src: 'osm', outer: [x0, z0, x1, z0, x1, z1, x0, z1], eave, roofH: 0, roof: 'flat', storey: 3.5, colour: '#d9c39a', roofColour: '#9b4f37',
});

describe('sky view', () => {
  // a street 10 m wide between two rows 12 m high, running along x
  const street = [block('a', -100, -40, 100, -5), block('b', -100, 5, 100, 40)];
  const f = heightField(street, [-200, -200, 200, 200]);

  it('rasterises the roofs', () => {
    const at = (x: number, z: number) => f.h[Math.floor(z - f.z0) * f.nx + Math.floor(x - f.x0)]!;
    expect(at(0, -20)).toBeCloseTo(12, 5);
    expect(at(0, 0)).toBe(0);
  });
  it('a wall in a street sees less sky low down than at its eaves, and less than a free wall', () => {
    // the front of row a at z = −5 faces +z, across the street
    const low = wallSky(f, 0, -5, 0, 1, 0.5), high = wallSky(f, 0, -5, 0, 1, 11);
    expect(low).toBeLessThan(high);
    expect(low).toBeGreaterThan(0.1);
    const open = heightField([block('a', -100, -40, 100, -5)], [-200, -200, 200, 200]);
    expect(wallSky(open, 0, -5, 0, 1, 0.5)).toBeCloseTo(1, 5);
  });
  it('the street sees less sky than an open square, and an open square all of it', () => {
    const empty = heightField([], [-200, -200, 200, 200]);
    expect(groundSkyAt(empty, 0, 0)).toBeCloseTo(1, 5);
    const s = groundSkyAt(f, 0, 0);
    expect(s).toBeLessThan(0.75);
    expect(s).toBeGreaterThan(0.2);
  });
});
