// Held keys by KeyboardEvent.code; a key never pressed reads undefined.
export const keys: Record<string, boolean> = Object.create(null);

/* Look: mouse movement while the pointer is locked, accumulated
   between frames and consumed by the walker. */
export const look = { dx: 0, dy: 0 };

addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  keys[e.code] = true;
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('mousemove', (e) => {
  if (!document.pointerLockElement) return;
  look.dx += e.movementX; look.dy += e.movementY;
});

/* Touch: the left half of the screen is a stick (drag from where the
   thumb lands to walk), the right half looks. Read by the walker like
   the keys: stick.x/z in −1..1. */
export const stick = { x: 0, z: 0, on: false };
const touches = new Map<number, { x0: number; y0: number; x: number; y: number; left: boolean }>();
addEventListener('touchstart', (e) => {
  for (const t of Array.from(e.changedTouches)) touches.set(t.identifier, { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, left: t.clientX < innerWidth / 2 });
  stick.on = true;
}, { passive: true });
addEventListener('touchmove', (e) => {
  for (const t of Array.from(e.changedTouches)) {
    const s = touches.get(t.identifier);
    if (!s) continue;
    if (s.left) {
      stick.x = Math.max(-1, Math.min(1, (t.clientX - s.x0) / 60));
      stick.z = Math.max(-1, Math.min(1, (t.clientY - s.y0) / 60));
    } else { look.dx += (t.clientX - s.x) * 1.6; look.dy += (t.clientY - s.y) * 1.6; }
    s.x = t.clientX; s.y = t.clientY;
  }
}, { passive: true });
const end = (e: TouchEvent) => {
  for (const t of Array.from(e.changedTouches)) {
    if (touches.get(t.identifier)?.left) { stick.x = 0; stick.z = 0; }
    touches.delete(t.identifier);
  }
};
addEventListener('touchend', end);
addEventListener('touchcancel', end);
