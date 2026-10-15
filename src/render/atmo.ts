/* ── Atmosphere: the model ───────────────────────────────────────
   Single scattering in a spherical atmosphere (Nishita): Rayleigh
   scattering by the air, Mie scattering and absorption by haze (dust,
   and in a town of 1900 the smoke of its coal stoves), absorption by
   ozone, which keeps the twilight sky blue. Light scattered more than
   once is approximated as an isotropic share of the sunlight at each
   point. Rays that meet the ground pick up the land's own light.

   The same numbers and steps run on the GPU (sky.ts, ATMO_GLSL) to
   fill the sky's lookup table; here they give the sun's colour and
   strength where you stand and the sky's light on level ground, for
   the key light, the land in the environment map and the exposure.

   Pure: imports nothing, so the tests can run it.

   Units: metres; the sun's irradiance above the atmosphere is sunE
   per channel, a scale chosen so the noon sun at the ground comes to
   about 5 (the units the lamps and lit windows are tuned in). */

export const ATMO = {
  Rg: 6360e3,                                        // ground, m from the centre
  Rt: 6420e3,                                        // top of the atmosphere
  rayleigh: [5.802e-6, 13.558e-6, 33.1e-6] as const, // scattering at sea level, 1/m (Hillaire 2020)
  Hr: 8000,                                          // its scale height
  // Haze: about ten times a clean sky's aerosols, some of it soot that
  // absorbs; with the air, a visibility of about 25 km.
  mieS: 1.0e-4, mieA: 1.6e-5, Hm: 1200, g: 0.76,
  ozone: [0.65e-6, 1.881e-6, 0.085e-6] as const,     // absorption at its peak, 25 km up, 30 km wide
  ground: 0.13,                                      // albedo of the land seen from afar
  ms: 0.35,                                          // multiple scattering, as a share of the single, isotropic
  sunE: 5.6,
} as const;

export type RGB = [number, number, number];
type V3 = [number, number, number];

const { Rg, Rt } = ATMO;

/* Distances along a ray from o (relative to the planet's centre) in
   direction d to a sphere of radius R: [near, far], or null. */
export function raySphere(o: V3, d: V3, R: number): [number, number] | null {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - R * R;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

/* Extinction per metre at height h. */
function extinction(h: number, out: RGB): RGB {
  const dR = Math.exp(-h / ATMO.Hr), dM = Math.exp(-h / ATMO.Hm), dO = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
  for (let k = 0; k < 3; k++) out[k] = ATMO.rayleigh[k]! * dR + (ATMO.mieS + ATMO.mieA) * dM + ATMO.ozone[k]! * dO;
  return out;
}

/* Transmittance from point p toward the sun (direction s): zero if
   the ground is in the way. */
export function sunTransmittance(p: V3, s: V3, steps = 12): RGB {
  const g = raySphere(p, s, Rg);
  if (g && g[0] > 0) return [0, 0, 0];
  const a = raySphere(p, s, Rt);
  if (!a) return [1, 1, 1];
  const L = a[1], dt = L / steps, od: RGB = [0, 0, 0], e: RGB = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const x = p[0] + s[0] * t, y = p[1] + s[1] * t, z = p[2] + s[2] * t;
    extinction(Math.hypot(x, y, z) - Rg, e);
    for (let k = 0; k < 3; k++) od[k]! += e[k]! * dt;
  }
  return [Math.exp(-od[0]), Math.exp(-od[1]), Math.exp(-od[2])];
}

const phaseR = (mu: number) => 3 / (16 * Math.PI) * (1 + mu * mu);
const phaseM = (mu: number) => { const g = ATMO.g, g2 = g * g; return (1 - g2) / (4 * Math.PI * Math.pow(1 + g2 - 2 * g * mu, 1.5)); };

/* Radiance of the sky seen from height h in direction d, the sun in
   direction s (both unit, y up). skyE: the sky's irradiance on level
   ground, for the light of the land where the ray ends on it. */
export function skyRadiance(h: number, d: V3, s: V3, skyE: RGB = [0, 0, 0], steps = 24): RGB {
  const o: V3 = [0, Rg + h, 0];
  const a = raySphere(o, d, Rt);
  if (!a) return [0, 0, 0];
  const g = raySphere(o, d, Rg);
  const hitGround = !!g && g[0] > 0;
  const tMax = hitGround ? g![0] : a[1];
  const mu = d[0] * s[0] + d[1] * s[1] + d[2] * s[2];
  const pR = phaseR(mu), pM = phaseM(mu), iso = ATMO.ms / (4 * Math.PI);
  const L: RGB = [0, 0, 0], T: RGB = [1, 1, 1], e: RGB = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    // samples crowd toward the eye, where the air is densest
    const t0 = tMax * (i / steps) ** 2, t1 = tMax * ((i + 1) / steps) ** 2, t = (t0 + t1) / 2, dt = t1 - t0;
    const p: V3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const hp = Math.hypot(p[0], p[1], p[2]) - Rg;
    extinction(hp, e);
    const dR = Math.exp(-hp / ATMO.Hr), dM = Math.exp(-hp / ATMO.Hm);
    const Ts = sunTransmittance(p, s, 6);
    for (let k = 0; k < 3; k++) {
      const sR = ATMO.rayleigh[k]! * dR, sM = ATMO.mieS * dM;
      const S = ((sR * pR + sM * pM) + (sR + sM) * iso) * Ts[k]! * ATMO.sunE;
      const x = Math.exp(-e[k]! * dt);
      L[k]! += T[k]! * S * (1 - x) / e[k]!;
      T[k]! *= x;
    }
  }
  if (hitGround) {
    const p: V3 = [o[0] + d[0] * tMax, o[1] + d[1] * tMax, o[2] + d[2] * tMax];
    const r = Math.hypot(p[0], p[1], p[2]);
    const cos = Math.max(0, (p[0] * s[0] + p[1] * s[1] + p[2] * s[2]) / r);
    const Ts = sunTransmittance(p, s, 6);
    for (let k = 0; k < 3; k++) L[k]! += T[k]! * ATMO.ground / Math.PI * (ATMO.sunE * Ts[k]! * cos + skyE[k]!);
  }
  return L;
}

/* The sky's irradiance on level ground at height h: the radiance
   over the upper hemisphere, cosine-weighted, by quadrature. */
export function skyIrradiance(h: number, s: V3): RGB {
  const E: RGB = [0, 0, 0];
  const NE = 8, NA = 12;
  for (let i = 0; i < NE; i++) {
    // equal steps in sin² of the elevation weight each row by cos·dω
    const u0 = i / NE, u1 = (i + 1) / NE, sinE = Math.sqrt((u0 + u1) / 2), cosE = Math.sqrt(1 - sinE * sinE);
    for (let j = 0; j < NA; j++) {
      const az = (j + 0.5) / NA * 2 * Math.PI;
      const L = skyRadiance(h, [cosE * Math.cos(az), sinE, cosE * Math.sin(az)], s, [0, 0, 0], 12);
      // ∫cos dω over the band = π (u1 − u0), shared by NA directions
      for (let k = 0; k < 3; k++) E[k]! += L[k]! * Math.PI * (u1 - u0) / NA;
    }
  }
  return E;
}

/* The light where the eye is, for a sun at altitude alt (radians):
   the sun's irradiance (per channel, on a surface facing it), the
   sky's on level ground, and the total on level ground. */
export function lightAt(alt: number, h = 30) {
  const s: V3 = [Math.cos(alt), Math.sin(alt), 0];
  const T = sunTransmittance([0, Rg + h, 0], s);
  const sun: RGB = [T[0] * ATMO.sunE, T[1] * ATMO.sunE, T[2] * ATMO.sunE];
  const sky = skyIrradiance(h, s);
  const up = Math.max(0, Math.sin(alt));
  const ground: RGB = [sun[0] * up + sky[0], sun[1] * up + sky[1], sun[2] * up + sky[2]];
  return { sun, sky, ground };
}

/* The GLSL twin of skyRadiance (and the lookup table's mapping), for
   sky.ts. Keep the two in step. */
const f = (x: number) => x.toExponential(6);
const v = (a: readonly number[]) => `vec3(${a.map(f).join(', ')})`;
export const ATMO_GLSL = /* glsl */ `
const float A_RG = ${f(Rg)}, A_RT = ${f(Rt)};
const vec3 A_BR = ${v(ATMO.rayleigh)};
const vec3 A_BO = ${v(ATMO.ozone)};
const float A_HR = ${f(ATMO.Hr)}, A_HM = ${f(ATMO.Hm)}, A_MS = ${f(ATMO.mieS)}, A_MA = ${f(ATMO.mieA)}, A_G = ${f(ATMO.g)};
const float A_GROUND = ${f(ATMO.ground)}, A_ISO = ${f(ATMO.ms / (4 * Math.PI))}, A_SUNE = ${f(ATMO.sunE)};
const float A_PI = 3.14159265;
vec2 aSphere(vec3 o, vec3 d, float R) {
  float b = dot(o, d), c = dot(o, o) - R * R, disc = b * b - c;
  if (disc < 0.0) return vec2(-1.0, -2.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}
vec3 aExt(float h) {
  float dO = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
  return A_BR * exp(-h / A_HR) + (A_MS + A_MA) * exp(-h / A_HM) + A_BO * dO;
}
vec3 aSunT(vec3 p, vec3 s) {
  vec2 g = aSphere(p, s, A_RG);
  if (g.x > 0.0) return vec3(0.0);
  float L = aSphere(p, s, A_RT).y, dt = L / 6.0;
  vec3 od = vec3(0.0);
  for (int i = 0; i < 6; i++) od += aExt(length(p + s * ((float(i) + 0.5) * dt)) - A_RG) * dt;
  return exp(-od);
}
vec3 aSky(float h, vec3 d, vec3 s, vec3 skyE) {
  vec3 o = vec3(0.0, A_RG + h, 0.0);
  vec2 a = aSphere(o, d, A_RT), g = aSphere(o, d, A_RG);
  bool ground = g.x > 0.0;
  float tMax = ground ? g.x : a.y;
  float mu = dot(d, s);
  float pR = 3.0 / (16.0 * A_PI) * (1.0 + mu * mu);
  float pM = (1.0 - A_G * A_G) / (4.0 * A_PI * pow(1.0 + A_G * A_G - 2.0 * A_G * mu, 1.5));
  vec3 L = vec3(0.0), T = vec3(1.0);
  for (int i = 0; i < 24; i++) {
    float t0 = tMax * pow(float(i) / 24.0, 2.0), t1 = tMax * pow(float(i + 1) / 24.0, 2.0);
    float t = 0.5 * (t0 + t1), dt = t1 - t0;
    vec3 p = o + d * t;
    float hp = length(p) - A_RG;
    vec3 e = aExt(hp);
    vec3 sR = A_BR * exp(-hp / A_HR);
    float sM = A_MS * exp(-hp / A_HM);
    vec3 S = ((sR * pR + sM * pM) + (sR + sM) * A_ISO) * aSunT(p, s) * A_SUNE;
    vec3 x = exp(-e * dt);
    L += T * S * (1.0 - x) / e;
    T *= x;
  }
  if (ground) {
    vec3 p = o + d * tMax;
    float c = max(0.0, dot(normalize(p), s));
    L += T * A_GROUND / A_PI * (A_SUNE * aSunT(p, s) * c + skyE);
  }
  return L;
}
`;

/* The sky-view lookup table: u the azimuth from the sun's (0..π, the
   sky is symmetric about the sun's vertical), v the elevation, packed
   toward the horizon where the sky changes fastest. */
export const LUT_GLSL = /* glsl */ `
vec3 skyLUT(sampler2D lut, vec3 dir, vec3 sun) {
  vec2 a = dir.xz, b = sun.xz;
  float la = length(a), lb = length(b);
  float c = la > 1e-5 && lb > 1e-5 ? dot(a, b) / (la * lb) : 1.0;
  float u = acos(clamp(c, -1.0, 1.0)) / 3.14159265;
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / 1.5707963);
  return texture2D(lut, vec2(u, v)).rgb;
}
`;
