import * as THREE from 'three';

/* ── Swifts ─────────────────────────────────────────────────────
   From May to the start of August swifts nest under the eaves of old
   towns and hunt over the roofs all day: a dozen or so wheel round
   where you are, fast and high, now and then a screaming party sweeps
   down a street at the height of the gutters. Each flies toward a goal
   it changes every few seconds, at 9–16 m/s, banking into its turns;
   its wings flicker in bursts and it glides between. Seen from below
   they are dark sickles, a few pixels across, which is all that has
   to look right.

   One small mesh, rebuilt every frame (a dozen birds, a few triangles
   each). `screams()` hands main.ts the distances of birds that called
   this frame, for the sound. */

const N = 14;
interface Bird { p: THREE.Vector3; v: THREE.Vector3; goal: THREE.Vector3; t: number; flap: number; glide: number; low: number }

export function buildSwifts() {
  const birds: Bird[] = [];
  let seed = 23;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) birds.push({
    p: new THREE.Vector3((rnd() - 0.5) * 120, 25 + rnd() * 25, (rnd() - 0.5) * 120),
    v: new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize().multiplyScalar(12),
    goal: new THREE.Vector3(), t: 0, flap: rnd() * 6, glide: 0, low: 0,
  });
  // per bird: body (2 tris), two wings (2 tris each, a sickle bent back)
  const TRI = 6, pos = new Float32Array(N * TRI * 9), nrm = new Float32Array(N * TRI * 9);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  for (let i = 0; i < nrm.length; i += 3) nrm[i + 1] = -1;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1c1814, roughness: 0.9, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  const called: number[] = [];
  const f = new THREE.Vector3(), r = new THREE.Vector3(), u = new THREE.Vector3(), tmp = new THREE.Vector3();
  let k = 0;
  const put = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => { for (const q of [a, b, c]) { pos[k++] = q.x; pos[k++] = q.y; pos[k++] = q.z; } };
  return {
    mesh,
    screams: called,
    where: () => birds.map((b) => [Math.round(b.p.x), Math.round(b.p.y), Math.round(b.p.z)]),
    /* dt: seconds; (x, z): where you are; on: whether they are about
       (the season, the hours of light) */
    step(dt: number, x: number, z: number, ground: number, on: boolean) {
      called.length = 0;
      mesh.visible = on;
      if (!on) return;
      k = 0;
      for (const b of birds) {
        // (one far off — you flew, or jumped to a landmark — comes back at once)
        if (Math.hypot(b.p.x - x, b.p.z - z) > 250) { b.p.set(x + (rnd() - 0.5) * 160, ground + 25 + rnd() * 25, z + (rnd() - 0.5) * 160); b.t = 0; }
        if ((b.t -= dt) <= 0) {
          // a new goal round you: mostly high, sometimes down a street
          b.t = 2 + rnd() * 4;
          b.low = rnd() < 0.12 ? 1 : 0;
          const a = rnd() * Math.PI * 2, d = 20 + rnd() * 90;
          b.goal.set(x + Math.cos(a) * d, ground + (b.low ? 9 + rnd() * 5 : 22 + rnd() * 35), z + Math.sin(a) * d);
          if (b.low) called.push(b.p.distanceTo(tmp.set(x, ground + 1.7, z)));
        }
        // steer toward the goal, at a swift's speed
        tmp.copy(b.goal).sub(b.p);
        const want = tmp.normalize().multiplyScalar(b.low ? 16 : 11);
        b.v.lerp(want, 1 - Math.exp(-dt * 0.9));
        const sp = b.v.length();
        if (sp < 8) b.v.multiplyScalar(8 / sp);
        b.p.addScaledVector(b.v, dt);
        // and now and then a call
        if (rnd() < dt * 0.15) called.push(b.p.distanceTo(tmp.set(x, ground + 1.7, z)));
        // the wings: bursts of flicker, then a glide
        if ((b.glide -= dt) < -1.2) b.glide = 0.6 + rnd() * 1.5;
        b.flap += dt * (b.glide > 0 ? 0 : 55);
        const beat = b.glide > 0 ? 0.1 : Math.sin(b.flap) * 0.5;
        // the bird's frame: forward, right, up (banked into the turn)
        f.copy(b.v).normalize();
        r.set(-f.z, 0, f.x).normalize();
        const bank = THREE.MathUtils.clamp(tmp.copy(want).sub(b.v).dot(r) * 0.08, -0.9, 0.9);
        u.set(0, 1, 0).applyAxisAngle(f, bank); r.crossVectors(f, u).normalize();
        const P = (fw: number, rt: number, up: number) => new THREE.Vector3().copy(b.p).addScaledVector(f, fw).addScaledVector(r, rt).addScaledVector(u, up);
        // body: a slim spindle 17 cm long
        put(P(0.1, 0, 0), P(-0.07, 0.02, 0), P(-0.07, -0.02, 0));
        put(P(-0.07, 0.015, 0), P(-0.12, 0.035, 0), P(-0.12, -0.035, 0));
        // wings: 21 cm each, swept back into a sickle, beating
        for (const s of [1, -1]) {
          const tipUp = beat * 0.12;
          put(P(0.04, 0, 0), P(-0.02, s * 0.11, tipUp * 0.5), P(-0.05, s * 0.02, 0));
          put(P(-0.02, s * 0.11, tipUp * 0.5), P(-0.14, s * 0.21, tipUp), P(-0.06, s * 0.1, tipUp * 0.4));
        }
      }
      geo.attributes.position!.needsUpdate = true;
    },
  };
}
