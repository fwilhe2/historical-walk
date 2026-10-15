import { describe, expect, it } from 'vitest';
import { lightAt, skyRadiance } from '../src/render/atmo';

const deg = (d: number) => d * Math.PI / 180;
const sunAt = (d: number): [number, number, number] => [Math.cos(deg(d)), Math.sin(deg(d)), 0];

describe('atmosphere', () => {
  it('lights level ground about five parts sun to one part sky at noon in summer', () => {
    const l = lightAt(deg(60));
    const ratio = l.sun[1] * Math.sin(deg(60)) / l.sky[1];
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(7);
    expect(l.sun[1]).toBeGreaterThan(4);   // the units the lamps are tuned in
  });
  it('reddens and dims the sun toward the horizon, and puts it out below', () => {
    const high = lightAt(deg(45)).sun, low = lightAt(deg(4)).sun, set = lightAt(deg(-1)).sun;
    expect(low[1]).toBeLessThan(high[1] / 5);
    expect(low[0] / low[2]).toBeGreaterThan(3 * high[0] / high[2]);
    expect(set).toEqual([0, 0, 0]);
  });
  it('keeps a blue sky overhead and a brighter one round the sun', () => {
    const s = sunAt(30);
    const zen = skyRadiance(30, [0, 1, 0], s);
    expect(zen[2]).toBeGreaterThan(zen[0] * 1.5);
    const towardSun = skyRadiance(30, [Math.cos(deg(25)), Math.sin(deg(25)), 0], s);
    const away = skyRadiance(30, [-Math.cos(deg(25)), Math.sin(deg(25)), 0], s);
    expect(towardSun[1]).toBeGreaterThan(away[1] * 3);
  });
  it('still lights the sky after sunset, fading by civil twilight', () => {
    const at = (d: number) => lightAt(deg(d)).sky[1];
    expect(at(-2)).toBeGreaterThan(at(60) / 200);
    expect(at(-6)).toBeLessThan(at(-2) / 20);
    expect(at(-12)).toBeLessThan(1e-5);
  });
});
