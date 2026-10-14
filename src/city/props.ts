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
  const group = new THREE.Group();
  group.name = 'walls';
  const solid = city.walls.filter((w) => w.kind !== 'railing'), rails = city.walls.filter((w) => w.kind === 'railing');
  const mat = new THREE.MeshStandardMaterial({ color: 0xc4b59a, roughness: 0.95, side: THREE.DoubleSide });
  const walls = new THREE.Mesh(wallGeometry(solid, true), mat);
  walls.castShadow = walls.receiveShadow = true;
  // Railings: one thin sheet each, its bars cut out of it in the shader
  // (balusters every 12 cm, a top and a bottom rail, a post every 2 m).
  const rmat = new THREE.MeshStandardMaterial({ color: 0x1d1f20, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide, alphaTest: 0.5 });
  rmat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vR;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvR = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vR;')
      .replace('#include <alphatest_fragment>', `
        float bar = step(abs(fract(vR.x / 0.12) - 0.5), 0.12);
        float post = step(abs(fract(vR.x / 2.0) - 0.5), 0.022);
        float railT = step(abs(vR.y - 0.98), 0.05), railB = step(abs(vR.y - 0.12), 0.035);
        float a = max(max(bar, post), max(railT, railB));
        if (a < 0.5) discard;
      `);
  };
  rmat.customProgramCacheKey = () => 'railing';
  const railing = new THREE.Mesh(wallGeometry(rails, false), rmat);
  railing.castShadow = true;
  group.add(walls, railing);
  return group;
}

/* Boxes along wall lines (thick: with a top), or single sheets. */
function wallGeometry(list: City['walls'], thick: boolean) {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], u0: number, u1: number) => {
    for (const [p, u] of [[a, [u0, a[1]!]], [b, [u0, b[1]!]], [c, [u1, c[1]!]], [a, [u0, a[1]!]], [c, [u1, c[1]!]], [d, [u1, d[1]!]]] as [number[], number[]][]) {
      pos.push(p[0]!, p[1]!, p[2]!); nrm.push(n[0]!, n[1]!, n[2]!); uv.push(u[0]!, u[1]!);
    }
  };
  for (const w of list) {
    const r = w.pts, h = w.h, t = thick ? w.t / 2 : 0;
    let u = 0;
    for (let i = 2; i < r.length; i += 2) {
      const ax = r[i - 2]!, az = r[i - 1]!, bx = r[i]!, bz = r[i + 1]!;
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      const nx = dz / L, nz = -dx / L;
      const ex = dx / L * t, ez = dz / L * t;
      const A = [ax - ex, az - ez], B = [bx + ex, bz + ez];
      const L1 = [A[0]! + nx * t, A[1]! + nz * t], L2 = [B[0]! + nx * t, B[1]! + nz * t];
      const R1 = [A[0]! - nx * t, A[1]! - nz * t], R2 = [B[0]! - nx * t, B[1]! - nz * t];
      quad([L1[0]!, 0, L1[1]!], [L1[0]!, h, L1[1]!], [L2[0]!, h, L2[1]!], [L2[0]!, 0, L2[1]!], [nx, 0, nz], u, u + L);
      if (thick) {
        quad([R2[0]!, 0, R2[1]!], [R2[0]!, h, R2[1]!], [R1[0]!, h, R1[1]!], [R1[0]!, 0, R1[1]!], [-nx, 0, -nz], u + L, u);
        quad([L1[0]!, h, L1[1]!], [R1[0]!, h, R1[1]!], [R2[0]!, h, R2[1]!], [L2[0]!, h, L2[1]!], [0, 1, 0], u, u + L);
      }
      u += L;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
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

/* Gas lanterns: a cast-iron post with a four-sided lantern on top,
   whose glass glows when the light goes (lampGlow, set from the sun). */
export const lampGlow = { value: 0 };
export function buildLamps(city: City) {
  const group = new THREE.Group();
  group.name = 'lamps';
  const n = city.lamps.length;
  if (!n) return group;
  const iron = new THREE.MeshStandardMaterial({ color: 0x23282a, roughness: 0.6, metalness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xd8d0b0, roughness: 0.2, emissive: 0xffb45a, emissiveIntensity: 0 });
  glass.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = lampGlow;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(1.0, 0.7, 0.35) * uGlow * 6.0;');
  };
  glass.customProgramCacheKey = () => 'lampglass';
  const parts: [THREE.BufferGeometry, THREE.Material][] = [
    [new THREE.CylinderGeometry(0.05, 0.09, 3.1, 8).translate(0, 1.55, 0), iron],
    [new THREE.CylinderGeometry(0.14, 0.17, 0.5, 8).translate(0, 0.25, 0), iron],
    [new THREE.CylinderGeometry(0.06, 0.06, 0.12, 6).translate(0, 3.12, 0), iron],
    [new THREE.CylinderGeometry(0.24, 0.14, 0.55, 4, 1).rotateY(Math.PI / 4).translate(0, 3.45, 0), glass],
    [new THREE.ConeGeometry(0.3, 0.3, 4).rotateY(Math.PI / 4).translate(0, 3.87, 0), iron],
  ];
  const m = new THREE.Matrix4();
  for (const [g, mat] of parts) {
    const inst = new THREE.InstancedMesh(g, mat, n);
    city.lamps.forEach((l, i) => inst.setMatrixAt(i, m.makeTranslation(l.x, 0, l.z)));
    inst.castShadow = mat === iron;
    group.add(inst);
  }
  return group;
}

/* Rails: two steel strips per track, set flush in the ground (the
   horse tram's in the setts, the railway's on its ballast). Standard
   gauge, 1435 mm. */
export function buildRails(city: City) {
  const pos: number[] = [], nrm: number[] = [];
  const G = 1.435 / 2, W = 0.035;
  for (const r of city.rails) {
    const p = r.pts;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2]!, az = p[i - 1]!, bx = p[i]!, bz = p[i + 1]!;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (const off of [-G, G]) {
        const q = (o: number) => [ax + nx * o, az + nz * o, bx + nx * o, bz + nz * o];
        const [x0, z0, x1, z1] = q(off - W), [x2, z2, x3, z3] = q(off + W);
        // two triangles facing up
        for (const [x, z] of [[x0, z0], [x3, z3], [x1, z1], [x0, z0], [x2, z2], [x3, z3]] as [number, number][]) {
          pos.push(x, 0.012, z); nrm.push(0, 1, 0);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const mat = new THREE.MeshStandardMaterial({ color: 0x8c8f92, roughness: 0.25, metalness: 0.9, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'rails';
  return mesh;
}
