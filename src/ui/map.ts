import type { City } from '../city/types';

// every city's map raster, by path; the city names its own
const MAPS = import.meta.glob<string>('../../data/*/*.png', { query: '?url', import: 'default', eager: true });

/* ── The map of 1903 ────────────────────────────────────────────
   M opens the historical map the town was checked against, centred on
   you, with an arrow for where you stand and look and the names of
   the landmarks. The wheel (or + and −) zooms; it follows you as you
   walk. The image covers the city's bounds exactly, pixel for pixel
   linear in the local frame (tools/fetch.ts). */
const img = new Image();
let open = false, zoom = 0.75, city: City;
const panel = document.createElement('div');
panel.id = 'map';
panel.hidden = true;
panel.innerHTML = '<canvas></canvas><div class="cap"></div>';
document.body.append(panel);
const cv = panel.querySelector('canvas')!;
const g = cv.getContext('2d')!;
panel.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.min(6, Math.max(0.4, zoom * (e.deltaY > 0 ? 0.85 : 1.18))); }, { passive: false });
addEventListener('keydown', (e) => {
  if (!open) return;
  if (e.code === 'Equal' || e.code === 'NumpadAdd') zoom = Math.min(6, zoom * 1.25);
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') zoom = Math.max(0.4, zoom / 1.25);
});

export const historicMap = {
  init(c: City) {
    city = c;
    const url = c.map ? MAPS[`../../data/${c.id}/${c.map.file}`] : undefined;
    if (url) img.src = url;
    panel.querySelector('.cap')!.innerHTML = `${c.map?.caption ?? ''} · <b>M</b> close · wheel zoom`;
  },
  toggle() { open = !open; panel.hidden = !open; return open; },
  get open() { return open; },
  draw(x: number, z: number, yaw: number) {
    if (!open || !img.complete || !city) return;
    const W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(devicePixelRatio, 2);
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const [x0, z0, x1, z1] = city.bounds;
    const ppm = zoom * dpr;                                        // screen pixels per metre
    const sx = img.naturalWidth / (x1 - x0), sz = img.naturalHeight / (z1 - z0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#e9e1cf'; g.fillRect(0, 0, cv.width, cv.height);
    // the map, positioned so that (x, z) is at the centre
    g.setTransform(ppm / sx, 0, 0, ppm / sz, cv.width / 2 - (x - x0) * ppm, cv.height / 2 - (z - z0) * ppm);
    g.imageSmoothingEnabled = true;
    g.drawImage(img, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // landmark names
    g.font = `${Math.round(11 * dpr)}px Georgia, serif`;
    g.textAlign = 'center';
    for (const l of city.labels) {
      if (l.kind !== 'landmark') continue;
      const px = cv.width / 2 + (l.x - x) * ppm, py = cv.height / 2 + (l.z - z) * ppm;
      if (px < 0 || py < 0 || px > cv.width || py > cv.height) continue;
      g.lineWidth = 3 * dpr; g.strokeStyle = 'rgba(240,232,214,.9)'; g.strokeText(l.text, px, py);
      g.fillStyle = '#5a2c14'; g.fillText(l.text, px, py);
    }
    // you: an arrow along your heading
    g.translate(cv.width / 2, cv.height / 2);
    g.rotate(-yaw);
    g.beginPath();
    const s = 9 * dpr;
    g.moveTo(0, -s * 1.4); g.lineTo(s * 0.8, s); g.lineTo(0, s * 0.45); g.lineTo(-s * 0.8, s); g.closePath();
    g.fillStyle = '#c0392b'; g.fill();
    g.lineWidth = 1.5 * dpr; g.strokeStyle = '#fff'; g.stroke();
    g.setTransform(1, 0, 0, 1, 0, 0);
  },
};
