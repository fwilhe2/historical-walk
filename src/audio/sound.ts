/* ── Sound ──────────────────────────────────────────────────────
   Everything is synthesised, nothing is fetched:

   - Footsteps, by what is underfoot: granite setts ring short and
     hard, slabs dull, gravel crunches, grass and earth hardly sound.
   - A town's murmur: brown noise low in the mix, a little louder in
     the streets than in the parks.
   - Birds where there are trees: short chirped phrases, more of them
     the more trees are near.
   - Bells strike the hours from the church towers, as loud as the
     distance allows (a bell's partials: hum, prime, minor third,
     fifth, octave …, each with its own decay).

   The context starts on the first click (browsers want a gesture);
   N mutes. */
import type { Surface } from '../city/ground';

let ctx: AudioContext | null = null;
let master: GainNode, murmur: GainNode;
let muted = false;
let noise: AudioBuffer;

function start() {
  if (ctx) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(ctx.destination);
  // a second of white noise, reused by every footstep and the murmur
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // the murmur: brown noise from the white by a leaky integrator
  const brown = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const b = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < b.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
  const src = ctx.createBufferSource();
  src.buffer = brown; src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 380;
  murmur = ctx.createGain();
  murmur.gain.value = 0.05;
  src.connect(lp).connect(murmur).connect(master);
  src.start();
}

const STEP: Record<Surface, { f: number; q: number; type: BiquadFilterType; dur: number; gain: number }> = {
  setts: { f: 1900, q: 1.4, type: 'bandpass', dur: 0.07, gain: 0.55 },
  slabs: { f: 900, q: 0.9, type: 'bandpass', dur: 0.08, gain: 0.4 },
  gravel: { f: 3200, q: 0.5, type: 'highpass', dur: 0.16, gain: 0.3 },
  rail: { f: 2600, q: 0.6, type: 'highpass', dur: 0.14, gain: 0.3 },
  earth: { f: 500, q: 0.7, type: 'lowpass', dur: 0.09, gain: 0.35 },
  grass: { f: 700, q: 0.7, type: 'lowpass', dur: 0.12, gain: 0.18 },
  water: { f: 600, q: 0.7, type: 'lowpass', dur: 0.1, gain: 0.1 },
};

let birdT = 2;

export const sound = {
  unlock() { start(); void ctx?.resume(); },
  toggleMute() {
    muted = !muted;
    if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.05);
    return muted;
  },
  step(surface: Surface, pace: number) {
    if (!ctx || muted) return;
    const s = STEP[surface], t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = s.type; f.frequency.value = s.f * (0.85 + Math.random() * 0.3); f.Q.value = s.q;
    const g = ctx.createGain();
    const peak = s.gain * (0.6 + 0.5 * Math.min(1, pace / 2));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + s.dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.8, s.dur + 0.02);
  },
  /* Once a frame: the murmur's level, and now and then a bird. */
  update(dt: number, trees: number, street: boolean) {
    if (!ctx || muted) return;
    murmur.gain.setTargetAtTime(street ? 0.06 : 0.035, ctx.currentTime, 1.5);
    birdT -= dt;
    if (birdT <= 0) {
      birdT = 1.5 + Math.random() * (trees > 0 ? 9 / Math.min(trees, 12) : 30);
      if (trees > 0 || Math.random() < 0.15) bird(Math.min(1, 0.25 + trees * 0.05));
    }
  },
  /* A bell at distance d (m) striking n times. */
  bell(n: number, d: number, pitch: number) {
    if (!ctx || muted) return;
    const vol = 0.9 / (1 + d / 120);
    for (let k = 0; k < n; k++) strike(ctx.currentTime + 0.3 + k * 2.6, pitch, vol);
  },
};

function bird(vol: number) {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.05;
  const notes = 3 + Math.floor(Math.random() * 5);
  const base = 2600 + Math.random() * 2200;
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.random() * 1.6 - 0.8;
  pan.connect(master);
  for (let i = 0; i < notes; i++) {
    const t = t0 + i * (0.09 + Math.random() * 0.07);
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = base * (0.9 + Math.random() * 0.25);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.35 : 0.75), t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05 * vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.075);
    o.connect(g).connect(pan);
    o.start(t); o.stop(t + 0.09);
  }
}

// A church bell's partials relative to the strike note, with decay times.
const PARTIALS: [number, number, number][] = [
  [0.5, 0.35, 7], [1, 0.5, 4.5], [1.183, 0.3, 3.5], [1.506, 0.22, 2.6], [2, 0.3, 2.2], [2.514, 0.14, 1.6], [2.662, 0.1, 1.4], [3.011, 0.08, 1.1],
];
function strike(t: number, f: number, vol: number) {
  if (!ctx) return;
  for (const [r, a, decay] of PARTIALS) {
    const o = ctx.createOscillator();
    o.frequency.value = f * r;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a * vol * 0.25, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay * 1.6);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + decay * 1.6 + 0.05);
  }
}
