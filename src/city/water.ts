import * as THREE from 'three';
import type { Ground } from './ground';
import type { City } from './types';

/* ── Water: the Havel and the Stadtkanal ────────────────────────
   One plane at the river's level under the whole town; the ground
   discards where the plan has water, so it shows only there. Its
   edges get quay walls — dressed stone from the street down past the
   water line — along every edge of a water area that has land
   behind it (edges between two water areas are skipped, by asking
   the ground's raster a step to either side). */

export const waterTime = { value: 0 };

export function buildWater(city: City, ground: Ground) {
  const group = new THREE.Group();
  group.name = 'water';
  const [x0, z0, x1, z1] = city.bounds;
  const M = 1500;
  const geo = new THREE.PlaneGeometry(x1 - x0 + 2 * M, z1 - z0 + 2 * M, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, city.water, (z0 + z1) / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1d2a26, roughness: 0.06, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = waterTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uT;\nvarying vec3 vWp;')
      .replace('#include <normal_fragment_maps>', /* glsl */ `
        // a few travelling ripple trains, fading with distance
        vec2 q = vWp.xz;
        float fade = 1.0 - smoothstep(30.0, 400.0, length(vWp - cameraPosition));
        vec2 g = vec2(0.0);
        g += vec2(0.8, 0.6) * cos(dot(q, vec2(0.8, 0.6)) * 2.1 + uT * 1.7) * 0.05;
        g += vec2(-0.5, 0.86) * cos(dot(q, vec2(-0.5, 0.86)) * 3.3 + uT * 2.3) * 0.035;
        g += vec2(0.3, -0.95) * cos(dot(q, vec2(0.3, -0.95)) * 5.9 + uT * 3.1) * 0.02;
        g += vec2(-0.9, -0.3) * cos(dot(q, vec2(-0.9, -0.3)) * 9.7 + uT * 4.2) * 0.012;
        normal = normalize(normal + (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz * fade);
      `);
  };
  mat.customProgramCacheKey = () => 'water';
  const plane = new THREE.Mesh(geo, mat);
  plane.receiveShadow = true;
  group.add(plane);

  // Quays.
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  const top = 0, bot = city.water - 0.8;
  for (const ar of city.areas) {
    if (ar.kind !== 'water') continue;
    for (const r of [ar.outer, ...(ar.holes ?? [])]) {
      const n = r.length;
      let u = 0;
      for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
        const ax = r[j]!, az = r[j + 1]!, bx = r[i]!, bz = r[i + 1]!;
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
        if (L < 0.01) continue;
        // which side is land? try both normals
        const mx = (ax + bx) / 2, mz = (az + bz) / 2, nx = dz / L, nz = -dx / L;
        const w1 = ground.isWater(mx + nx * 2, mz + nz * 2), w2 = ground.isWater(mx - nx * 2, mz - nz * 2);
        if (w1 === w2) { u += L; continue; }
        // the wall's face looks into the water
        const fx = w1 ? nx : -nx, fz = w1 ? nz : -nz;
        const quad = [[ax, top, az, u, top], [bx, top, bz, u + L, top], [bx, bot, bz, u + L, bot], [ax, bot, az, u, bot]];
        const cross = (bx - ax) * fz - (bz - az) * fx;   // sign tells the winding that faces (fx, fz)
        const order = cross < 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        for (const k of order) {
          const v = quad[k]!;
          pos.push(v[0]!, v[1]!, v[2]!); nrm.push(fx, 0, fz); uv.push(v[3]!, v[4]!);
        }
        u += L;
      }
    }
  }
  const qg = new THREE.BufferGeometry();
  qg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  qg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  qg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const qm = new THREE.MeshStandardMaterial({ color: 0x8a847a, roughness: 0.9, side: THREE.DoubleSide });
  qm.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vQ;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvQ = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vQ;')
      .replace('#include <map_fragment>', /* glsl */ `
        vec2 b = vQ / vec2(0.9, 0.45);
        b.x += 0.5 * mod(floor(b.y), 2.0);
        vec2 f = fract(b);
        float j = smoothstep(0.0, 0.06 + fwidth(b.x), min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y) * 2.0));
        float tone = fract(sin(dot(floor(b), vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb *= mix(0.6, 1.0, j) * (0.85 + 0.25 * tone);
        // wet and green below the water line
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.45, 0.5, 0.4), smoothstep(${(city.water + 0.25).toFixed(2)}, ${(city.water - 0.05).toFixed(2)}, vQ.y));
      `);
  };
  qm.customProgramCacheKey = () => 'quay';
  const quays = new THREE.Mesh(qg, qm);
  quays.receiveShadow = true;
  group.add(quays);
  return group;
}
