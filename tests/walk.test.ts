import { describe, expect, it } from 'vitest';
import { buildSegs, pushOut } from '../src/player/collide';
import { parseView, viewHash } from '../src/app/view';
import { area, buffer, inset, inside, simplify, straighten } from '../src/geom/poly';
import type { City } from '../src/city/types';

const city = (over: Partial<City> = {}): City => ({
  id: 't', name: 'T', year: 1900, origin: [0, 0], bounds: [-100, -100, 100, 100], spawn: { x: 0, z: 0, yaw: 0 },
  buildings: [{ id: 'b', src: 'osm', outer: [0, 0, 10, 0, 10, 10, 0, 10], eave: 8, roofH: 0, roof: 'flat', storey: 3, colour: '#ffffff', roofColour: '#ffffff' }],
  areas: [], streets: [], walls: [], rails: [], trees: [], columns: [], lamps: [], labels: [], water: -1.6, credits: [], ...over,
});

describe('collision', () => {
  it('keeps the walker out of a building, at its radius from the wall', () => {
    const S = buildSegs(city());
    const [x, z] = pushOut(S, 5, -0.1, 0.3);   // just outside the north wall, overlapping it
    expect(z).toBeCloseTo(-0.3, 5);
    expect(x).toBeCloseTo(5, 5);
  });
  it('slides along a wall instead of stopping', () => {
    const S = buildSegs(city());
    // walking diagonally into the west wall: z keeps its motion
    const [x, z] = pushOut(S, -0.1, 5.5, 0.3);
    expect(x).toBeCloseTo(-0.3, 5);
    expect(z).toBeCloseTo(5.5, 5);
  });
  it('lets you through arcades and gate passages (walls starting above head height)', () => {
    const c = city();
    c.buildings[0]!.base = 4.6;
    const S = buildSegs(c);
    expect(pushOut(S, 5, -0.1, 0.3)).toEqual([5, -0.1]);
  });
  it('stops you at lamp posts', () => {
    const S = buildSegs(city({ buildings: [], lamps: [{ x: 20, z: 20 }] }));
    const [x] = pushOut(S, 20.2, 20, 0.3);
    expect(x).toBeGreaterThan(20.4);
  });
});

describe('view hash', () => {
  it('round-trips a view', () => {
    const h = viewHash({ x: 12.34, z: -56.78, yaw: Math.PI / 2, pitch: -0.1, fly: true, y: 40 }, 16.5);
    const v = parseView(h)!;
    expect(v.x).toBeCloseTo(12.3, 1); expect(v.z).toBeCloseTo(-56.8, 1);
    expect(v.yaw).toBeCloseTo(Math.PI / 2, 2); expect(v.t).toBe(16.5); expect(v.y).toBe(40);
  });
  it('rejects what is not a view', () => {
    expect(parseView('#x=abc&z=1')).toBeNull();
    expect(parseView('')).toBeNull();
    expect(parseView('#x=1&z=2&t=99')!.t).toBe(24);
  });
});

describe('polygons', () => {
  const sq = [0, 0, 10, 0, 10, 10, 0, 10];
  it('insets a square evenly', () => {
    const r = inset(sq, 1);
    expect(Math.abs(area(r))).toBeCloseTo(64, 5);
    expect(inside(r, 5, 5)).toBe(true);
    expect(inside(r, 0.5, 5)).toBe(false);
  });
  it('buffers a line into a band of the right width', () => {
    const b = buffer([0, 0, 100, 0], 4);
    expect(Math.abs(area(b.ring))).toBeCloseTo(800, 5);
  });
  it('simplifies away collinear points, and straightens wobble', () => {
    expect(simplify([0, 0, 5, 0.01, 10, 0, 10, 10, 0, 10], 0.1).length).toBe(8);
    expect(straighten([0, 0, 5, 0.3, 10, 0, 10, 10, 0, 10], 0.2, 0.5).length).toBe(8);
  });
});
