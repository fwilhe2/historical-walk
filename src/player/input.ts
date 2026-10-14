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
