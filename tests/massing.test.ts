import { describe, expect, it } from 'vitest';
import { buildMassing, roofAt, roofBuf, wallBuf } from '../src/city/massing';
import type { Building } from '../src/city/types';

const rect = (w: number, d: number): number[] => [0, 0, w, 0, w, d, 0, d];
const house = (over: Partial<Building> = {}): Building => ({
  id: 'w1', src: 'osm', outer: rect(20, 10), eave: 10, roofH: 5, roof: 'gabled', storey: 3.5, colour: '#d9c39a', roofColour: '#9b4f37', ...over,
});

describe('roofs', () => {
  it('a gable rises from the eaves to the ridge along the long axis', () => {
    const b = house();
    expect(roofAt(b, 10, 5)).toBeCloseTo(5, 5);       // ridge in the middle
    expect(roofAt(b, 10, 0)).toBeCloseTo(0, 5);       // long side at the eaves
    expect(roofAt(b, 0, 5)).toBeCloseTo(5, 5);        // gable end reaches the ridge
    expect(roofAt(b, 10, 2.5)).toBeCloseTo(2.5, 5);
  });
  it('a hip is low at the short ends too', () => {
    const b = house({ roof: 'hipped' });
    expect(roofAt(b, 0, 5)).toBeCloseTo(0, 5);
    expect(roofAt(b, 10, 5)).toBeCloseTo(5, 5);
  });
  it('a given ridge bearing overrides the long axis', () => {
    const b = house({ ridge: Math.PI / 2 });
    // ridge along z now: the long sides are the gables
    expect(roofAt(b, 10, 0)).toBeCloseTo(5, 5);
  });
  it('roof faces cover the footprint exactly once, and walls close up to them', () => {
    for (const roof of ['gabled', 'hipped', 'mansard', 'half-hipped', 'pyramidal', 'flat'] as const) {
      const b = house({ roof, outer: [0, 0, 20, 0, 22, 6, 18, 11, 1, 10] });   // not a rectangle
      const w = wallBuf(), r = roofBuf();
      buildMassing(b, w, r);
      // projected roof area equals the footprint's
      let a = 0;
      for (let i = 0; i < r.pos.length; i += 9) {
        const [x0, , z0, x1, , z1, x2, , z2] = r.pos.slice(i, i + 9) as number[] as [number, number, number, number, number, number, number, number, number];
        a += Math.abs((x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0)) / 2;
      }
      expect(a, roof).toBeCloseTo(211.5, 0);   // shoelace area of the outline
      // every roof face points up
      for (let i = 1; i < r.nrm.length; i += 3) expect(r.nrm[i]!).toBeGreaterThan(0);
      // every wall top vertex lies on the roof surface
      for (let i = 0; i < w.pos.length; i += 3) {
        const y = w.pos[i + 1]!;
        if (y <= 0) continue;
        expect(y - 10, roof).toBeCloseTo(roofAt(b, w.pos[i]!, w.pos[i + 2]!), 3);
      }
    }
  });
  it('walls face out of the building', () => {
    const b = house();
    const w = wallBuf(), r = roofBuf();
    buildMassing(b, w, r);
    for (let i = 0; i < w.pos.length; i += 9) {
      const p = w.pos.slice(i, i + 9);
      const e1 = [p[3]! - p[0]!, p[4]! - p[1]!, p[5]! - p[2]!], e2 = [p[6]! - p[0]!, p[7]! - p[1]!, p[8]! - p[2]!];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const cx = (p[0]! + p[3]! + p[6]!) / 3 - 10, cz = (p[2]! + p[5]! + p[8]!) / 3 - 5;
      expect(n[0]! * cx + n[2]! * cz).toBeGreaterThan(0);
      // and the stored normal agrees with the winding
      expect(n[0]! * w.nrm[i]! + n[2]! * w.nrm[i + 2]!).toBeGreaterThan(0);
    }
  });
});
