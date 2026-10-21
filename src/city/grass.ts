import * as THREE from 'three';
import type { Ground } from './ground';
import { heightAt } from './terrain';
import { coverageMipmaps, treeTime } from './trees';

/* ── Grass ──────────────────────────────────────────────────────
   Near you, the lawns and verges stand up off the ground: small
   upright cards of painted blades, scythed lawn of some 8–20 cm,
   one every 25 cm or so wherever the ground is grass (ground.ts),
   turned every way. Their places come from a fixed grid with a jitter
   by cell, so they stay put as you walk; they shrink to nothing toward
   R, so none pops in. Lit as the ground is (their normals point up),
   swaying a little at the tips. */

const R = 22, CELL = 0.25, MAX = Math.ceil((2 * R / CELL) ** 2 * 0.8);

function hash(i: number, j: number, k: number) {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* A card of blades on a transparent canvas: tapered, curving, thick at
   the foot and fine at the tips, greens with some dry straw. */
function bladeTexture() {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 420; i++) {
    const x = 10 + rnd() * (W - 20), h = H * (0.3 + 0.67 * rnd()), lean = (rnd() - 0.5) * 0.9, w = 2.5 + rnd() * 3;
    const dry = rnd() < 0.12, l = 0.5 + rnd() * 0.5;
    const r = dry ? 130 * l : 42 * l + 20, gg = dry ? 115 * l : 70 * l + 30, b = dry ? 60 * l : 24 * l + 10;
    const tx = x + lean * h, cx = x + lean * h * 0.3;
    g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
    g.beginPath();
    g.moveTo(x - w / 2, H);
    g.quadraticCurveTo(cx - w / 3, H - h * 0.5, tx, H - h);
    g.quadraticCurveTo(cx + w / 3, H - h * 0.5, x + w / 2, H);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  coverageMipmaps(t, c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

export function buildGrass(ground: Ground) {
  // one card: 0.4 m across, 1 high (scaled per instance), foot at y = 0
  const geo = new THREE.PlaneGeometry(0.4, 1).translate(0, 0.5, 0);
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const mat = new THREE.MeshStandardMaterial({ map: bladeTexture(), alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTreeT = treeTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTreeT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec2 ph = vec2(0.0);
          #ifdef USE_INSTANCING
          ph = instanceMatrix[3].xz;
          #endif
          float k = uv.y * uv.y;
          transformed.x += sin(uTreeT * 2.1 + ph.x * 1.7 + ph.y * 1.3) * 0.06 * k;
        }`);
  };
  // lit as the lawn is, from either side
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
  };
  mat.customProgramCacheKey = () => 'grass';
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const col = new THREE.Color();
  let lx = NaN, lz = NaN;
  return {
    mesh,
    update(x: number, z: number, fly: boolean) {
      if (fly) { mesh.count = 0; lx = NaN; return; }
      if (Math.hypot(x - lx, z - lz) < 3) return;
      lx = x; lz = z;
      let n = 0;
      const i0 = Math.floor((x - R) / CELL), i1 = Math.floor((x + R) / CELL);
      const j0 = Math.floor((z - R) / CELL), j1 = Math.floor((z + R) / CELL);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1 && n < MAX; i++) {
        const gx = (i + hash(i, j, 1)) * CELL, gz = (j + hash(i, j, 2)) * CELL;
        const d = Math.hypot(gx - x, gz - z);
        if (d > R || !ground.isGrass(gx, gz)) continue;
        // shrink toward the edge of the ring; taller and thinner by chance
        // and shorter at the lawn's edge, where it is trodden and cut back
        const edge = (ground.isGrass(gx + 0.6, gz) ? 0.25 : 0) + (ground.isGrass(gx - 0.6, gz) ? 0.25 : 0) + (ground.isGrass(gx, gz + 0.6) ? 0.25 : 0) + (ground.isGrass(gx, gz - 0.6) ? 0.25 : 0);
        const fade = Math.min(1, (R - d) / 5) * (0.35 + 0.65 * edge * edge);
        const h = (0.08 + 0.12 * hash(i, j, 3)) * fade;
        e.set((hash(i, j, 5) - 0.5) * 0.35, hash(i, j, 4) * Math.PI * 2, 0);
        // (on the pavement's level: all but the carriageway stands a kerb high, ground.ts)
        m.compose(p.set(gx, heightAt(gx, gz) + 0.14, gz), q.setFromEuler(e), s.set(fade * (0.7 + 0.6 * hash(i, j, 6)), h, 1));
        mesh.setMatrixAt(n, m);
        // a little lighter, darker, yellower card by card
        const v = 0.72 + 0.3 * hash(i, j, 7), dry = 0.1 + hash(i, j, 8) * 0.3;
        mesh.setColorAt(n, col.setRGB(v * (1 + dry), v * (1 + dry * 0.5), v * (1 - dry * 0.5)));
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    },
  };
}
