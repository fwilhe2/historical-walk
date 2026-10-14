/* A view as a URL hash: #x=…&z=…&yaw=…&pitch=…&t=…[&y=…]. x and z in
   metres, angles in degrees (yaw 0 = north, 90 = west), t the hour,
   y an eye height that means flying. Untrusted: only finite numbers
   are taken. */
export interface View { x: number; z: number; yaw: number; pitch: number; t?: number; y?: number }

export function parseView(hash: string): View | null {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const n = (k: string) => { const v = q.get(k); if (v === null) return undefined; const f = Number(v); return Number.isFinite(f) ? f : undefined; };
  const x = n('x'), z = n('z');
  if (x === undefined || z === undefined) return null;
  const v: View = { x, z, yaw: (n('yaw') ?? 0) * Math.PI / 180, pitch: (n('pitch') ?? 0) * Math.PI / 180 };
  const t = n('t'), y = n('y');
  if (t !== undefined) v.t = Math.max(0, Math.min(24, t));
  if (y !== undefined) v.y = Math.max(1, Math.min(2000, y));
  return v;
}

export function viewHash(w: { x: number; z: number; yaw: number; pitch: number; fly: boolean; y: number }, hour: number) {
  const d = (r: number) => (r * 180 / Math.PI).toFixed(1);
  let h = `#x=${w.x.toFixed(1)}&z=${w.z.toFixed(1)}&yaw=${d(w.yaw)}&pitch=${d(w.pitch)}&t=${hour.toFixed(2)}`;
  if (w.fly) h += `&y=${w.y.toFixed(1)}`;
  return h;
}
