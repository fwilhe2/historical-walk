import * as THREE from 'three';
import type { City } from './types';

/* ── Trees and walls ────────────────────────────────────────────
   Trees: one instanced trunk and one instanced crown, a lumpy
   icosphere (linden and chestnut were the avenue trees of Potsdam),
   sized per tree from the data. Walls: the excise wall of 1733,
   which still closed the town in 1900 (it came down 1900–1905), and
   garden walls, as plastered boxes along their lines with a coping. */

function lumpy(radius: number) {
  const g = new THREE.IcosahedronGeometry(radius, 2);
  const p = g.attributes.position!;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 3.1) * Math.sin(v.y * 2.7 + 1) * Math.sin(v.z * 3.7 + 2);
    v.multiplyScalar(1 + 0.18 * n);
    v.y *= 0.85;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildTrees(city: City) {
  const group = new THREE.Group();
  group.name = 'trees';
  const n = city.trees.length;
  if (!n) return group;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 1, 6).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x4a3c30, roughness: 0.95 }), n);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  crownMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLp = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLp;\nfloat tH(vec3 p){return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453);}')
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat lf = tH(floor(vLp * 5.0));\ndiffuseColor.rgb *= 0.6 + 0.6 * lf;');
  };
  crownMat.customProgramCacheKey = () => 'crown';
  const crown = new THREE.InstancedMesh(lumpy(1), crownMat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  const col = new THREE.Color();
  city.trees.forEach((tr, i) => {
    const trunkH = tr.h * 0.38;
    m.compose(t.set(tr.x, 0, tr.z), q.identity(), s.set(1 + tr.r * 0.06, trunkH + tr.r * 0.5, 1 + tr.r * 0.06));
    trunk.setMatrixAt(i, m);
    q.setFromAxisAngle(t.set(0, 1, 0), (i * 2.399) % (Math.PI * 2));
    m.compose(t.set(tr.x, trunkH + (tr.h - trunkH) * 0.5, tr.z), q, s.set(tr.r, (tr.h - trunkH) * 0.55, tr.r));
    crown.setMatrixAt(i, m);
    const k = (i * 0.618) % 1;
    crown.setColorAt(i, col.setRGB(0.12 + 0.05 * k, 0.2 + 0.06 * k, 0.07));
  });
  trunk.castShadow = crown.castShadow = true;
  crown.receiveShadow = true;
  group.add(trunk, crown);
  return group;
}

export function buildWalls(city: City) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], u0: number, u1: number) => {
    for (const [p, u] of [[a, [u0, a[1]!]], [b, [u1, b[1]!]], [c, [u1, c[1]!]], [a, [u0, a[1]!]], [c, [u1, c[1]!]], [d, [u0, d[1]!]]] as [number[], number[]][]) {
      pos.push(p[0]!, p[1]!, p[2]!); nrm.push(n[0]!, n[1]!, n[2]!); uv.push(u[0]!, u[1]!);
    }
  };
  for (const w of city.walls) {
    const r = w.pts, h = w.h, t = w.t / 2;
    let u = 0;
    for (let i = 2; i < r.length; i += 2) {
      const ax = r[i - 2]!, az = r[i - 1]!, bx = r[i]!, bz = r[i + 1]!;
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      const nx = dz / L * t, nz = -dx / L * t;
      // extend each piece by half the thickness so corners close
      const ex = dx / L * t, ez = dz / L * t;
      const A = [ax - ex, az - ez], B = [bx + ex, bz + ez];
      const L1 = [A[0]! + nx, A[1]! + nz], L2 = [B[0]! + nx, B[1]! + nz], R1 = [A[0]! - nx, A[1]! - nz], R2 = [B[0]! - nx, B[1]! - nz];
      const n1 = [nx / t, 0, nz / t], n2 = [-nx / t, 0, -nz / t];
      quad([L1[0]!, 0, L1[1]!], [L1[0]!, h, L1[1]!], [L2[0]!, h, L2[1]!], [L2[0]!, 0, L2[1]!], n1, u, u + L);
      quad([R2[0]!, 0, R2[1]!], [R2[0]!, h, R2[1]!], [R1[0]!, h, R1[1]!], [R1[0]!, 0, R1[1]!], n2, u + L, u);
      quad([L1[0]!, h, L1[1]!], [R1[0]!, h, R1[1]!], [R2[0]!, h, R2[1]!], [L2[0]!, h, L2[1]!], [0, 1, 0], u, u + L);
      u += L;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const mat = new THREE.MeshStandardMaterial({ color: 0xc4b59a, roughness: 0.95, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'walls';
  return mesh;
}

/* Columns: an instanced shaft, plinth and capital each, in sandstone. */
export function buildColumns(city: City) {
  const group = new THREE.Group();
  group.name = 'columns';
  const n = city.columns.length;
  if (!n) return group;
  const mat = new THREE.MeshStandardMaterial({ color: 0xe4d8be, roughness: 0.85 });
  const shaft = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.88, 1, 1, 16).translate(0, 0.5, 0), mat, n);
  const plinth = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, n);
  const capital = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.45, 0.95, 1, 16).translate(0, 0.5, 0), mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  city.columns.forEach((c, i) => {
    const ph = Math.min(0.6, c.h * 0.05), ch = Math.min(1.4, c.h * 0.1);
    plinth.setMatrixAt(i, m.compose(t.set(c.x, c.base, c.z), q, s.set(c.r * 2.5, ph, c.r * 2.5)));
    shaft.setMatrixAt(i, m.compose(t.set(c.x, c.base + ph, c.z), q, s.set(c.r, c.h - ph - ch, c.r)));
    capital.setMatrixAt(i, m.compose(t.set(c.x, c.base + c.h - ch, c.z), q, s.set(c.r, ch, c.r)));
  });
  for (const x of [shaft, plinth, capital]) { x.castShadow = x.receiveShadow = true; group.add(x); }
  return group;
}
