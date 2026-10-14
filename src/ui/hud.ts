import { segDist2, inside } from '../geom/poly';
import type { Ground } from '../city/ground';
import type { City, Label } from '../city/types';

/* ── HUD ────────────────────────────────────────────────────────
   Where you are, in 1900's words: the street under your feet (by
   its name then), the building you are looking at or standing by,
   the time of day and your heading. Lookups run a few times a
   second, not every frame. */
const $ = (id: string) => document.getElementById(id)!;
let city: City;
let noteT = 0, lookT = 0, fpsN = 0, fpsT = 0;
let order: Label[] = [], next = 0;

function nearestStreet(x: number, z: number) {
  let best = '', bd = 30 * 30;
  for (const s of city.streets) {
    if (!s.name) continue;
    const p = s.pts;
    for (let i = 2; i < p.length; i += 2) {
      const d = segDist2(x, z, p[i - 2]!, p[i - 1]!, p[i]!, p[i + 1]!);
      if (d < bd) { bd = d; best = s.name; }
    }
  }
  return best;
}
function nearestBuilding(x: number, z: number) {
  let best = null as City['buildings'][number] | null, bd = 18 * 18;
  for (const b of city.buildings) {
    const r = b.outer;
    if (inside(r, x, z)) return b;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const d = segDist2(x, z, r[j]!, r[j + 1]!, r[i]!, r[i + 1]!);
      if (d < bd) { bd = d; best = b; }
    }
  }
  return best;
}

export const hud = {
  show(c: City) {
    city = c;
    $('hud').hidden = false;
    $('h-city').textContent = c.name.toUpperCase();
    $('h-year').textContent = String(c.year);
    order = c.labels.filter((l) => l.kind === 'landmark');
  },
  toggleClean() { $('hud').classList.toggle('clean'); },
  refresh() { lookT = 0; },
  nextLandmark(_x: number, _z: number) {
    if (!order.length) return null;
    const l = order[next++ % order.length]!;
    return l;
  },
  update(dt: number, w: { x: number; z: number; yaw: number }, hour: number, ground: Ground) {
    if (noteT > 0 && (noteT -= dt) <= 0) $('note').textContent = '';
    fpsN++; fpsT += dt;
    if (fpsT > 0.5) { $('h-fps').textContent = `${(fpsN / fpsT).toFixed(0)} fps · ${w.x.toFixed(0)} E ${(-w.z).toFixed(0)} N`; fpsN = 0; fpsT = 0; }
    if ((lookT -= dt) > 0) return;
    lookT = 0.4;
    $('h-street').textContent = nearestStreet(w.x, w.z) || (ground.surface(w.x, w.z) === 'grass' ? 'im Grünen' : '—');
    const b = nearestBuilding(w.x, w.z);
    // today's institutions' names would be out of place; addresses are not
    const named = b && (b.src === 'ohm' || b.src === 'model') ? b.name : undefined;
    $('h-near').textContent = b ? (named ?? b.addr ?? '') : '';
    // the story of a landmark within 60 m (its label sits at its centre)
    let about = '', ad = 60 * 60;
    for (const l of city.labels) {
      if (!l.about) continue;
      const d = (l.x - w.x) ** 2 + (l.z - w.z) ** 2;
      if (d < ad) { ad = d; about = `${l.text}. ${l.about}`; }
    }
    $('h-about').textContent = about;
    $('h-bld').textContent = b ? (b.year ? `${b.year}` : 'before 1900') + ' · ' + srcName(b.src) : '—';
    const h = Math.floor(hour), m = Math.round((hour - h) * 60);
    $('h-time').textContent = `${String(h).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
    const deg = ((-w.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const dirs = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
    $('h-hdg').textContent = `${deg.toFixed(0).padStart(3, '0')}° ${dirs[Math.round(deg / 45) % 8]}`;
  },
};
function srcName(s: string) { return s === 'osm' ? 'standing today' : s === 'ohm' ? 'lost · OHM' : 'lost · from the 1903 map'; }

export function note(t: string) { $('note').textContent = t; noteT = 3; }
