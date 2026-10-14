import { renderer, resize } from './renderer';
import { sun } from './sky';

/* ── Quality tiers ──────────────────────────────────────────────
   Q cycles high → medium → low; the choice is remembered. What they
   trade: the resolution, the sun's shadow map, and shadows at all.
   The starting tier on a first visit goes by the screen: a phone or
   a large high-density display starts at medium. */
export type Tier = 'high' | 'medium' | 'low';
const TIERS: Tier[] = ['high', 'medium', 'low'];
const SPEC: Record<Tier, { ratio: number; shadow: number }> = {
  high: { ratio: 1.5, shadow: 2048 },
  medium: { ratio: 1, shadow: 1024 },
  low: { ratio: 0.75, shadow: 0 },
};

function initial(): Tier {
  try { const t = localStorage.getItem('quality'); if (t === 'high' || t === 'medium' || t === 'low') return t; } catch { /* no storage */ }
  return matchMedia('(pointer: coarse)').matches || innerWidth * devicePixelRatio > 3000 ? 'medium' : 'high';
}

export const quality = {
  tier: initial(),
  apply() {
    const s = SPEC[this.tier];
    renderer.setPixelRatio(Math.min(devicePixelRatio, s.ratio));
    resize();
    renderer.shadowMap.enabled = s.shadow > 0;
    sun.castShadow = s.shadow > 0;
    if (s.shadow && sun.shadow.mapSize.x !== s.shadow) {
      sun.shadow.mapSize.set(s.shadow, s.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    // programs compiled with or without shadow code must be rebuilt
    renderer.shadowMap.needsUpdate = true;
  },
  cycle() {
    this.tier = TIERS[(TIERS.indexOf(this.tier) + 1) % TIERS.length]!;
    try { localStorage.setItem('quality', this.tier); } catch { /* no storage */ }
    this.apply();
    return this.tier;
  },
};
